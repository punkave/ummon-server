#!/usr/bin/env node

'use strict';

/**
 * Module dependencies.
 */
var optimist = require('optimist');
var npid = require('npid');
var path = require('path');
var restify = require('restify');
var socketio = require('socket.io');
var bunyan = require('bunyan');
var _ = require('underscore');
var ON_DEATH = require('death')({uncaughtException: true});


var argv = optimist.usage('Ummon and stuff', {
  'config': {
    description: 'The path to your ummon config.json file',
    string: true,
    alias: 'c',
  },
  'pidfile': {
    'default': 'ummon.pid',
    description: 'Set a custom pid file location',
    string: true,
    alias: 'p',
  }
}).argv;

// Create the pid file, throwing on failure
npid.create(argv.pidfile);

// It's possible to pass a string that will be the config path. Catch it here:
var ummonOptions = (argv.config) 
      ? {configPath: argv.config} 
      : {};

var ummon = require('./lib/ummon')(ummonOptions);


/**
 * Watch for and properly respond to signals
 */

ON_DEATH(function(signal, err) {
  if (!ummon.pause) {
    ummon.pause = true;

    ummon.log.info("Kill (%s) signal received. Waiting for workers to finish", signal);
    
    _.each(ummon.workers, function(run){
      run.worker.kill(signal);
    })

    setInterval(function(){
      var count = _.size(ummon.workers);

      if (0 === count) {
        ummon.log.info("All workers complete. Exiting");
        process.exit(0);
      }
      ummon.log.info("Still waiting for %s workers to finish", count);
    }, 250)
  }
});

// Don't explode if your're piping and it stops
process.stdout.on('error', function( err ) {
  if (err.code == "EPIPE") {
    process.exit(0);
  }
});


/**
 * Create Restify Server
 */

var server = restify.createServer({
  version: 0,
  name: 'Ummon',
  log: ummon.log
});
var io = socketio.listen(server);

// Because for some reason server.log doesn't automatically work
var log = bunyan.createLogger({
  name: 'API',
  stream: process.stdout
});

server.on('after', function(req, res, route, error){
  if (route) {
    log.info('%s - %s (matched by route %s)', res.statusCode, req.url, route.spec.path);
  } else {
    log.info('%s - %s', res.statusCode, req.url);
  }
});

server.on('uncaughtException', function(req, res, route, error){
  log.err(error);
});

// Middlewarez
server.use(restify.acceptParser(server.acceptable));
server.use(restify.requestLogger());
server.use(restify.bodyParser());
server.use(restify.queryParser());
server.use(restify.gzipResponse());
server.use(restify.CORS({
        origins: ['localhost', 'localhost:8888', 'localhost:3000'],   // defaults to ['*']
        // credentials: true                  // defaults to false
        // headers: ['x-foo']                 // sets expose-headers
    }));
server.use(restify.authorizationParser());

server.pre(restify.pre.sanitizePath());
server.use(restify.fullResponse());

server.use(function (req, res, next){
  if (ummon.config.credentials.indexOf(req.authorization.credentials) !== -1){
    next();
  } else {
    res.json(401, "Log in dummy. KWATZ!")
  }
})

// Set up the api
var api = require('./api')(ummon);

server.param('collection', api.doesCollectionExist);
server.param('taskid', api.doesTaskExist);

// The routes!
server.get('/ps/:pid', api.ps);
server.get('/ps', api.ps);
// server.post('/kill/:pid', api.kill);
server.get('/status', api.status);
server.post('/tasks/new', api.createTask);

server.get('/tasks/:taskid', api.getTask);
server.put('/tasks/:taskid', api.updateTask);
server.del('/tasks/:taskid', api.deleteTask);

server.get('/tasks', api.getTasks);
server.get('/collections/:collection', api.getTasks);
// server.post('/run/:taskid', api.run);
// server.post('/run', api.run);
server.get('/log/collection/:collection', api.showLog);
server.get('/log/task/:taskid', api.showLog);
server.get('/log/run/:runid', api.showLog);
server.get('/log', api.showLog);


var getRuns = _.throttle(function(){ return ummon.getRuns(); }, '500');

io.set('log level', 1);
io.sockets.on('connection', function (socket) {
    socket.emit('send:tasks', ummon.getTasks());
    
    // Send runs 
    // TODO: Is there a way to bind to multiple events with one listener?
    ummon.on('worker.start', function(){ socket.emit('send:runs', getRuns()); });
    ummon.on('worker.complete', function(){ socket.emit('send:runs', getRuns()); });
    ummon.on('queue.new', function(){ socket.emit('send:runs', getRuns()); });
});


server.listen(ummon.config.port, function() {
  console.log("               _  __              _       _ ");
  console.log("              | |/ __      ____ _| |_ ___| |");
  console.log("              | ' /\\ \\ /\\ / / _` | __|_  | |");
  console.log("              | . \\ \\ V  V | (_| | |_ / /|_|");
  console.log("              |_|\\_\\ \\_/\\_/ \\__,_|\\__/___(_)");
  console.log("");
  server.log.info({addr: server.address()}, 'listening');
});
