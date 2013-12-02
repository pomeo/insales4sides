
/**
 * Module dependencies.
 */

var express = require('express')
  , http = require('http')
  , rest = require('restler')
  , xml2js = require('xml2js')
  , util = require('util')
  , path = require('path');

var app = express();

// all environments
app.set('port', process.env.PORT || 3000);
app.use(express.favicon());
app.use(express.logger('dev'));
app.use(express.bodyParser());
app.use(express.methodOverride());
app.use(app.router);
app.use(express.static(path.join(__dirname, 'public')));

// development only
if ('development' == app.get('env')) {
  app.use(express.errorHandler());
}

app.get('/cities', function(req, res){
  rest.get('http://www.4sides.ru/common/api/calculate.php?action=get_data').on('complete', function(result) {
    if (result instanceof Error) {
      console.log('Error: ' + result.message);
    } else {
      rest.parsers.xml(result, function(err, newData) {
        res.send(newData);
      });
    }
  });
});

app.get('/', function(req, res){
  console.log('Регион : ' + req.query.region + ' Город : ' + req.query.city + ' Вес : ' + req.query.weight);
  //var url = 'http://4sides.ru/common/api/calculate.php?action=calculate_rf&from=' + req.query + '&to=' + req.query + '&weight=' + req.query + '&obl=' + req.query;
  res.setHeader('Content-Type', 'application/json');
  res.send(req.query.callback + '({delivery_price: 100})');
});

http.createServer(app).listen(app.get('port'), function(){
  console.log('Express server listening on port ' + app.get('port'));
});
