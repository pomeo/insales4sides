'use strict';
const express    = require('express');
const debug      = require('debug')('app');
const bodyParser = require('body-parser');
const logger     = require('morgan');
const path       = require('path');

let routes = require('./routes/index');

let app = express();

var kladr_key = process.env.kladrkey;
var kladr_token = process.env.kladrtoken;

app.set('port', process.env.PORT || 3000);

// all environments
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'jade');
if (app.get('env') !== 'development') {
  app.enable('view cache');
}
app.set('trust proxy', 1);
app.use(logger('dev'));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({
  extended: true
}));
app.use(express.static(path.join(__dirname, 'public')));

app.use('/', routes);

/// catch 404 and forwarding to error handler
app.use(function(req, res, next) {
  let err = new Error('Not Found');
  err.status = 404;
  next(err);
});

/// error handlers

// development error handler
// will print stacktrace
if (app.get('env') === 'development') {
  app.use((err, req, res, next) => {
    res.status(err.status || 500);
    res.render('error', {
      message: err.message,
      error: err
    });
  });
}

// production error handler
// no stacktraces leaked to user
app.use((err, req, res, next) => {
  res.status(err.status || 500);
  res.render('error', {
    message: err.message,
    error: {}
  });
});

app.listen(app.get('port'), '127.0.0.1', () => {
  debug('Express server listening on port ' + this.address().port);
});

// server with small memory, need manual release
setInterval(function () {
  global.gc();
}, 10000);
