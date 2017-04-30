'use strict';

/*!
 * Module dependencies.
 */
var spawn = require('child_process').spawn;
var domain = require('domain');
var path = require('path');
var fs = require('fs');
var _ = require('underscore');


/*
 * Exports
 */
module.exports = worker;
exports.Worker = Worker;


/**
 * The Worker!
 *
 * @param {Task} task A task object
 */
function Worker(run, ummon){
  var self = this;

  // Setup some defaults
  self.pid = null;
  self.run = run;

  // Setup log child
  var logOptions = {runid: run.id};
  if (run.task.id) { logOptions.taskid = run.task.id; }
  if (run.task.collection) { logOptions.collection = run.task.collection; }
  self.log = ummon.log.child(logOptions);

  // Setup the domain
  var d = domain.create();
  d.on('error', er => {
    self.log.error(er, 'WORKER DOMAIN ERROR');
  });

  d.run(() => {
    self.log.info('worker.start - %s', run.task.id);
    run.start();

    run.task.cwd = (run.task.cwd) ? path.resolve(run.task.cwd) : '.';

    var stats = fs.statSync(run.task.cwd);

    // If the cwd is a real directory...
    if (!stats.isDirectory()) {
      self.log.err('CWD provided for %s does not exist', run.task.id);
    } else {
      ummon.emit('worker.start', run);

      var running = spawn('sh', ['-c',run.task.command], {
        cwd: run.task.cwd,
        env: _.extend(process.env, run.task.env) // Add to the process variables
      });

      self.pid = running.pid; // Set the worker.pid
      run.pid = running.pid; // Give it to the run as well!
      self.run = run;
      self.worker = running;

      running.stdout.on('data', data => {
        self.log.info({workerIO:'stdout'}, data.toString().trim());
      });

      running.stderr.on('data', data => {
        self.log.error({workerIO:'stderr'}, data.toString().trim());
      });

      running.on('close', code => {
        run.complete(code);
        self.log.info('worker.complete - %s - Total time: %s (%d seconds), exit code %d', run.task.id, run.durationHuman(), run.duration()/1000, code);
        self.log.debug({run})
        ummon.emit('worker.complete', run);
      });
    }

  });
}


/*!
 * A simple worker constructor helper
 *
 * Example:
 *
 *     var worker = require('./worker');
 *
 *     var aWorker = worker(task);
 */
function worker(run, ummon) {
  return new Worker(run, ummon);
}