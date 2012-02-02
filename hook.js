var _=require('underscore');
var EventEmitter = require('eventemitter2').EventEmitter2;
var util = require ('util');
var nssocket = require('nssocket');

var Hook = function (options) {
	if (!options) options = {};
	
	// some hookio flags that we support
	this.listening = false;
	this.ready = false;
	
	// grab som options that we support
	this.local = options.local || false;
	
	// default eventemitter options
	var EventEmitterProps = {
		delimiter: "::",
		wildcard: true
	};
	
	EventEmitter.call(this, EventEmitterProps);

	var self = this;
	var clients = {};
	var client = null;
	var uid = 1;
	var eventTypes = {};
	
	// Function will attempt to start server, if it fails we assume that server already available
	// then it start in client mode. So first hook will became super hook, overs its clients
	this.start = function () {
		var server = nssocket.createServer(function (socket) {
			// assign unique client id
			var cliId = uid; uid++;
			var client = {id:cliId, name: "hook_"+cliId, socket:socket, proxy:new EventEmitter(EventEmitterProps)};
			clients[cliId] = client;
			// ignore errors, close will happens in anyway
			socket.on('error', function () {
			})
			// clean context on client lost
			socket.on('close', function () {
				delete clients[cliId];
			})
			// almost dummy hello greeting
			socket.data('tinyhook::hello', function (d) {
				client.name = d.name;
			})
			// handle on and off to filter delivery of messages
			// everybody deliver to server, server filter and deliver to clients
			// we'll use proxy/stub of native EventEmitter2 to repeat behavior
			socket.data('tinyhook::on', function (d) {
				if (client.proxy.listeners(d.type).length==0) {
					client.proxy.on(d.type, function (data) {
						client.socket.send('tinyhook::pushemit', data);
					})
				}
			})
			socket.data('tinyhook::off', function (d) {
				client.proxy.on(d.type);
			})
			// once we receive any event from child, deliver it to all clients
			// with smart filtering which is provided by EventEmitter2
			socket.data('tinyhook::emit', function (d) {
				d.event = client.name+"::"+d.event;
				_(clients).forEach(function (cli) {
					cli.proxy.emit(d.event,d);
				});
				// don't forget about ourselves
				self.emit(d.event, d.data);
			});
		});
		server.on('error', function (e) {
			if (e.code == 'EADDRINUSE')
				startClient();
		})
		server.on('listening', function () {
			self.listening = true;
			self.ready = true;
			delete eventTypes;
			EventEmitter.prototype.emit.apply(self,['hook::ready']);
		})
		server.listen(1976);
	}
	// if server start fails we attempt to start in client mode
	function startClient() {
		delete clients;
		client = new nssocket.NsSocket({reconnect:true});
		client.connect(1976);
		// when connection started we sayng hello and push
		// all known event types we have
		client.on('start', function () {
			client.send(['tinyhook','hello'],{protoVersion:1,name:options.name});
			// purge known event types
			_(eventTypes).keys().forEach(function(type) {
				client.send(['tinyhook','on'],{type:type});
			});
			if (!self.ready) {
				// simulate hook:ready
				self.ready = true;
				EventEmitter.prototype.emit.apply(self,['hook::ready']);
			}
		});
		// tranlate pushed emit to local one
		client.data('tinyhook::pushemit',function (d) {
			EventEmitter.prototype.emit.apply(self,[d.event,d.data]);
		});
		
		// every XX seconds do garbage collect and notify server about
		// event we longer not listening. Realtime notification is not necessary
		// Its ok if for some period we receive events that are not listened
		setInterval(function () {
			var newEventTypes;
			_(eventTypes).keys().forEach(function(type) {
				if (self.listeners(type).length>0) {
					client.send(['tinyhook','off'],{type:type});
					delete eventTypes[type];
				}
			});
		}, 60000);
	}
	
	// hook into core events to dispatch events as required
	this.emit = function (event,data,callback) {
		if (client) {
			client.send(['tinyhook','emit'],{eid:uid++,event:event,data:data}, function () {});
		}
		// still preserver local processing
		EventEmitter.prototype.emit.apply(self,arguments);
	}
	this.on = function (type, listener) {
		if (client) {
			client.send(['tinyhook','on'],{type:type}, function () {});
		};
		if (eventTypes)
			eventTypes[type]=1;
		EventEmitter.prototype.on.apply(self,[type, listener]);
	}
}

util.inherits(Hook, EventEmitter);
Hook.prototype.spawn = require('./spawn').spawn;
module.exports.Hook = Hook;
