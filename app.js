
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
  , csv = require('csv')
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
var f = function(res, req, region, city, data) {
  var jobj = JSON.parse(data);
  var we = req.query.weight;
  var n = 0;
  var weightList = [];
  var weightEqual = 0.1;
  var price = '';
  for (var weight in jobj[0].weight) {
    weightList.push(parseFloat(weight.replace(',', '.')));
  }
  weightList = weightList.sort(function(a, b){ return a - b });
  if (parseFloat(req.query.weight) < 0.1) {
    we = 0.1;
  }
  // если вдруг вес будет больше максимального веса службы доставки
  if (parseFloat(req.query.weight) > weightList[weightList.length-1]) {
    we = weightList[weightList.length-1];
  }
  // возвращаем +1 вес от текущего в шкале службы доставки
  async.whilst(function () {
    return weightList[n] <= we;
  }, function (next) {
    if (weightList[n] == weightList[weightList.length-1]) {
      weightEqual = weightList[n];
    } else {
      weightEqual = weightList[n+1];
    }
    n++;
    next();
  }, function (err) {
    // All things are done!
     });
  console.log("Округлённый вес: " + weightEqual);
  // делаем запрос в кладр для поиска региона, нужен номер окато
  rest.get('http://kladr-api.ru/api.php?query='+ region +'&contentType=region&withParent=1&limit=1&token=' + kladr_token + '&key=' + kladr_key).once('complete', function(kladr) {
    if (kladr instanceof Error) {
      console.log('Error: ' + kladr.message);
      res.setHeader('Content-Type', 'application/json');
      res.send(req.query.callback + '({error: \'Current carrier is not available!\'})');
    } else {
      console.log(kladr['result'][0]);
      if (kladr['result'][0] == '') {
        console.log('Не опознан регион: ' + region);
        res.setHeader('Content-Type', 'application/json');
        res.send(req.query.callback + '({error: \'Current carrier is not available!\'})');
      } else {
        // идём по массиву данных из output.json и сравниваем есть ли нужный регион
        async.eachSeries(jobj, function(item, callback) {
          if ((item.reg_okato == kladr['result'][0]['okato'])||(item.okato == kladr['result'][0]['okato'])) {
            console.log('Регион опознан: ' + kladr['result'][0]['name']);
            price = item.weight[weightEqual.toString().replace('.', ',')][1];
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
                  price = item.weight[weightEqual.toString().replace('.', ',')][0];
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
            // возвращаем цену
            if (price == '') {
              res.setHeader('Content-Type', 'application/json');
              res.send(req.query.callback + '({error: \'Current carrier is not available!\'})');
            } else {
              res.setHeader('Content-Type', 'application/json');
              res.send(req.query.callback + '({delivery_price: ' + price + '})');
            }
          }
        });
      }
    }
  });
};

// здесь мы создаём файл с данными, список городов службы доставки с номерами окато и регионами в которых они находятся. Номера окато берутся из кладра.
app.get('/update', function(req, res){
  var tariffs = []
    , cities = [];
  csv()
  .from.path(__dirname+'/public/tariffs.csv', { delimiter: ';', escape: '"' })
  .transform( function(row){
    return row;
  })
  .on('record', function(data,index){
    tariffs.push(data);
  })
  .on('end', function(count){
    csv()
    .from.path(__dirname+'/public/cities.csv', { delimiter: ';', escape: '"' })
    .transform( function(row){
      return row;
    })
    .on('record', function(row, index){
      var j = {};
      var e = [];
      async.eachSeries(tariffs, function(i, callback) {
        if (row[1] == 'м') {
          j[i[0]] = new Array(parseFloat(i[2]), parseFloat(i[5]));
          callback();
        } else if (row[1] == 'п') {
          j[i[0]] = new Array(parseFloat(i[1]), parseFloat(i[3]));
          callback();
        } else if (row[1] == 1) {
          j[i[0]] = new Array(parseFloat(i[4]), parseFloat(i[5]));
          callback();
        } else if (row[1] == 2) {
          j[i[0]] = new Array(parseFloat(i[6]), parseFloat(i[7]));
          callback();
        } else if (row[1] == 3) {
          j[i[0]] = new Array(parseFloat(i[8]), parseFloat(i[9]));
          callback();
        } else if (row[1] == 4) {
          j[i[0]] = new Array(parseFloat(i[10]), parseFloat(i[11]));
          callback();
        } else if (row[1] == 5) {
          j[i[0]] = new Array(parseFloat(i[12]), parseFloat(i[13]));
          callback();
        } else if (row[1] == 6) {
          j[i[0]] = new Array(parseFloat(i[14]), parseFloat(i[15]));
          callback();
        }
      }, function(err) {
           e = [row[0].toLowerCase(), row[1], j];
           cities.push({
             name: e[0],
             weight: e[2]
           });
         });
    })
    .on('end', function(count){
      //console.log(cities);
      //console.log(cities[79].weight['0,1'][0]);
      var c = [];
      async.eachSeries(cities, function(i, callback) {
        rest.get('http://kladr-api.ru/api.php?query='+ i.name +'&contentType=city&withParent=1&limit=1&token=' + kladr_token + '&key=' + kladr_key).once('complete', function(kladr) {
          if (kladr instanceof Error) {
            console.log('Error: ' + kladr.message);
          } else {
            if (i.name == 'москва') {
              c.push({
                name: i.name,
                kladr_name: kladr['result'][0]['name'].toLowerCase(),
                okato: kladr['result'][0]['okato'],
                kladr_regfullname: 'московская область',
                kladr_regname: 'московская',
                reg_okato: '46000000000',
                weight: i.weight
              });
            } else if (i.name == 'санкт-петербург') {
              c.push({
                name: i.name,
                kladr_name: kladr['result'][0]['name'].toLowerCase(),
                okato: kladr['result'][0]['okato'],
                kladr_regfullname: 'ленинградская область',
                kladr_regname: 'ленинградская',
                reg_okato: '41000000000',
                weight: i.weight
              });
            } else {
              c.push({
                name: i.name,
                kladr_name: kladr['result'][0]['name'].toLowerCase(),
                okato: kladr['result'][0]['okato'],
                kladr_regfullname: kladr['result'][0]['parents'][0]['name'].toLowerCase() + ' ' + kladr['result'][0]['parents'][0]['type'].toLowerCase(),
                kladr_regname: kladr['result'][0]['parents'][0]['name'].toLowerCase(),
                reg_okato: kladr['result'][0]['parents'][0]['okato'],
                weight: i.weight
              });
            }
            console.log(' done > ' + i.name);
          }
          callback();
        });
      }, function(err) {
           if(err) {
             console.log('A file failed to process');
           } else {
             fs.writeFile(__dirname + '/public/output.json', JSON.stringify(c), function(err) {
               if(err) {
                 console.log(err);
               } else {
                 console.log('The file was saved!');
                 res.send('ok');
               }
             });
           }
         });
    })
    .on('error', function(error){
      console.log(error.message);
    });
  })
  .on('error', function(error){
    console.log(error.message);
  });
});

// сюда прилетает get запрос от insales, делаем магию и отвечаем.
app.get('/', function(req, res){
  var region = req.query.region.replace(/^[а-яА-Я]{1,10}\s/g, '').toLowerCase();
  var city = req.query.city.toLowerCase();
  console.log('Регион : ' + req.query.region + '\nГород : ' + req.query.city + '\nВес : ' + req.query.weight);
  // это на случай если вдруг будет почтовый индекс, тогда опираемся на индекс. Если его не будет, работаем опираясь на регион и город.
  if (req.query.zip != 0) {
    fs.readFile(__dirname + '/public/output.json', 'utf8', function (err, data) {
      if (err) throw err;
      rest.get('http://postindexapi.ru/' + req.query.zip + '.json').once('complete', function(zip) {
        if (zip.error_message) {
          f(res, req, region, city, data);
        } else {
          var reg = zip.region.replace(/\s[а-яА-Я]{1,20}$/g, '').toLowerCase();
          var cit = zip.city.toLowerCase();
          f(res, req, reg, cit, data);
        }
      });
    });
  } else {
    fs.readFile(__dirname + '/public/output.json', 'utf8', function (err, data) {
      if (err) throw err;
      f(res, req, region, city, data);
    });
  }
});

http.createServer(app).listen(app.get('port'), function(){
  console.log('Express server listening on port ' + app.get('port'));
});
