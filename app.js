
/**
 * Module dependencies.
 */

var express = require('express')
  , http = require('http')
  , rest = require('restler')
  , xml2js = require('xml2js')
  , util = require('util')
  , fs = require('fs')
  , async = require('async')
  , path = require('path');

var app = express();

var kladr_key = process.env.kladrkey;
var kladr_token = process.env.kladrtoken;

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

// основная функция для поиска городов и регионов
var f = function(res, req, region, city, fin, data) {
  var jobj = JSON.parse(data);
  var we = req.query.weight;
  var n = 0;
  if (parseFloat(req.query.weight) == 0) {
    we = 0.1;
  }
  // если вдруг вес будет больше максимального веса службы доставки
  if (parseFloat(req.query.weight) > parseFloat(jobj[1][jobj[1].length-1])) {
    fin.w,we = jobj[1][jobj[1].length-1];
  }
  // возвращаем +1 вес от текущего в шкале службы доставки
  async.whilst(function () {
    return parseFloat(jobj[1][n]) <= we;
  }, function (next) {
    if (parseFloat(jobj[1][n]) == parseFloat(jobj[1][jobj[1].length-1])) {
      fin.w = jobj[1][n];
    } else {
      fin.w = jobj[1][n+1];
    }
    n++;
    next();
  }, function (err) {
    // All things are done!
  });
  // делаем запрос в кладр для поиска региона, нужен номер окато
  rest.get('http://kladr-api.ru/api.php?query='+ region +'&contentType=region&withParent=1&limit=1&token=' + kladr_token + '&key=' + kladr_key).once('complete', function(kladr) {
    if (kladr instanceof Error) {
      console.log('Error: ' + kladr.message);
      res.setHeader('Content-Type', 'application/json');
      res.send(req.query.callback + '({error: \'Current carrier is not available!\'})');
    } else {
      if (kladr['result'][0] == '') {
        console.log('Не опознан регион: ' + region);
        res.setHeader('Content-Type', 'application/json');
        res.send(req.query.callback + '({error: \'Current carrier is not available!\'})');
      } else {
        // идём по массиву данных из output.json и сравниваем есть ли нужный регион
        async.eachSeries(jobj[0], function(item, callback) {
          // отправная точка питер и id питера берём из файла, на случай что он может когда-нибудь поменяться
          if (item.name == 'санкт-петербург') {
            fin.from = item.id;
          }
          if ((item.reg_okato == kladr['result'][0]['okato'])||(item.okato == kladr['result'][0]['okato'])) {
            console.log('Регион опознан: ' + kladr['result'][0]['name']);
            fin.id = item.id;
            // ищем город в кладре, также нужен окато. Город нужен чтобы понять куда доставлять, в областной центр или область
            rest.get('http://kladr-api.ru/api.php?query='+ city +'&contentType=city&withParent=1&limit=1&token=' + kladr_token + '&key=' + kladr_key).once('complete', function(kladr_city) {
              if (kladr_city instanceof Error) {
                console.log('Error: ' + kladr_city.message);
                res.setHeader('Content-Type', 'application/json');
                res.send(req.query.callback + '({error: \'Current carrier is not available!\'})');
              } else if (typeof kladr_city['result'][0] === 'undefined') {
                callback();
              } else {
                if (item.okato == kladr_city['result'][0]['okato']) {
                  fin.obl = 0;
                }
                callback();
              }
            });
          } else {
            callback();
          }
        }, function(err) {
          if (err) {
            console.log(err);
            res.setHeader('Content-Type', 'application/json');
            res.send(req.query.callback + '({error: \'Current carrier is not available!\'})');
          } else {
            // делаем запрос к службе доставке за тарифом, и возвращаем в insales данные в заывисимости от ситуации
            var url = 'http://4sides.ru/common/api/calculate.php?action=calculate_rf&from=' + fin.from + '&to=' + fin.id + '&weight=' + fin.w + '&obl=' + fin.obl;
            console.log(url);
            rest.get(url).once('complete', function(sides) {
              if (sides instanceof Error) {
                console.log('Error: ' + sides.message);
                res.setHeader('Content-Type', 'application/json');
                res.send(req.query.callback + '({error: \'Current carrier is not available!\'})');
              } else {
                rest.parsers.xml(sides, function(err, data) {
                  if (typeof data['result']['tariff'] === 'undefined') {
                    res.setHeader('Content-Type', 'application/json');
                    res.send(req.query.callback + '({error: \'Current carrier is not available!\'})');
                  } else if ((data['result']['tariff'][0] != 0)&&(data['result']['tariff'][0] != '')) {
                    res.setHeader('Content-Type', 'application/json');
                    res.send(req.query.callback + '({delivery_price: ' + data['result']['tariff'][0] + '})');
                  } else {
                    res.setHeader('Content-Type', 'application/json');
                    res.send(req.query.callback + '({error: \'Current carrier is not available!\'})');
                  }
                });
              }
            });
          }
        });
      }
    }
  });
};

// здесь мы создаём файл с данными, список городов службы доставки с номерами окато и регионами в которых они находятся. Номера окато берутся из кладра.
app.get('/update', function(req, res){
  rest.get('http://www.4sides.ru/common/api/calculate.php?action=get_data').once('complete', function(result) {
    if (result instanceof Error) {
      console.log('Error: ' + result.message);
    } else {
      rest.parsers.xml(result, function(err, newData) {
        var jobj = [];
        var city = [];
        var weight = [];
        async.eachSeries(newData['result']['cities'][0]['city'], function(i, callback) {
          console.log(i.$.id);
          rest.get('http://kladr-api.ru/api.php?query='+ i._.replace(/\s+/g, '').toLowerCase() +'&contentType=city&withParent=1&limit=1&token=' + kladr_token + '&key=' + kladr_key).once('complete', function(kladr) {
            if (kladr instanceof Error) {
              console.log('Error: ' + kladr.message);
            } else {
              if (i._.replace(/\s+/g, '').toLowerCase() == 'москва') {
                city.push({
                  id: i.$.id,
                  name: i._.replace(/\s+/g, '').toLowerCase(),
                  kladr_name: kladr['result'][0]['name'].toLowerCase(),
                  okato: kladr['result'][0]['okato'],
                  kladr_regfullname: 'московская область',
                  kladr_regname: 'московская',
                  reg_okato: '46000000000'
                });
              } else if (i._.replace(/\s+/g, '').toLowerCase() == 'санкт-петербург') {
                city.push({
                  id: i.$.id,
                  name: i._.replace(/\s+/g, '').toLowerCase(),
                  kladr_name: kladr['result'][0]['name'].toLowerCase(),
                  okato: kladr['result'][0]['okato'],
                  kladr_regfullname: 'ленинградская область',
                  kladr_regname: 'ленинградская',
                  reg_okato: '41000000000'
                });
              } else {
                city.push({
                  id: i.$.id,
                  name: i._.replace(/\s+/g, '').toLowerCase(),
                  kladr_name: kladr['result'][0]['name'].toLowerCase(),
                  okato: kladr['result'][0]['okato'],
                  kladr_regfullname: kladr['result'][0]['parents'][0]['name'].toLowerCase() + ' ' + kladr['result'][0]['parents'][0]['type'].toLowerCase(),
                  kladr_regname: kladr['result'][0]['parents'][0]['name'].toLowerCase(),
                  reg_okato: kladr['result'][0]['parents'][0]['okato']
                });
              }
              console.log('done');
              callback();
            }
          });
        }, function(err) {
          if(err) {
            console.log('A file failed to process');
          } else {
            for (var i in newData['result']['weights'][0]['weight']) {
              var val = newData['result']['weights'][0]['weight'][i];
              weight.push(val);
            }
            jobj.push(city);
            jobj.push(weight);
            fs.writeFile(__dirname + '/public/output.json', JSON.stringify(jobj), function(err) {
              if(err) {
                console.log(err);
              } else {
                console.log('The file was saved!');
                res.send('ok');
              }
            });
          }
        });
      });
    }
  });
});

// сюда прилетает get запрос от insales, делаем магию и отвечаем.
app.get('/', function(req, res){
  var region = req.query.region.replace(/^[а-яА-Я]{1,10}\s/g, '').toLowerCase();
  var city = req.query.city.toLowerCase();
  var fin = ({
    from: 61,
    id: 0,
    obl: 1,
    w: 0
  });
  console.log('Регион : ' + req.query.region + '\nГород : ' + req.query.city + '\nВес : ' + req.query.weight);
  // это на случай если вдруг будет почтовый индекс, тогда опираемся на индекс. Если его не будет, работаем опираясь на регион и город.
  if (req.query.zip != 0) {
    fs.readFile(__dirname + '/public/output.json', 'utf8', function (err, data) {
      if (err) throw err;
      rest.get('http://postindexapi.ru/' + req.query.zip + '.json').once('complete', function(zip) {
        if (zip.error_message) {
          f(res, req, region, city, fin, data);
        } else {
          var reg = zip.region.replace(/\s[а-яА-Я]{1,20}$/g, '').toLowerCase();
          var cit = zip.city.toLowerCase();
          f(res, req, reg, cit, fin, data);
        }
      });
    });
  } else {
    fs.readFile(__dirname + '/public/output.json', 'utf8', function (err, data) {
      if (err) throw err;
      f(res, req, region, city, fin, data);
    });
  }
});

http.createServer(app).listen(app.get('port'), function(){
  console.log('Express server listening on port ' + app.get('port'));
});
