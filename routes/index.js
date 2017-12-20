'use strict';
const express  = require('express');
const router   = express.Router();
const fs       = require('fs');
const request  = require('request');
const util     = require('util');
const rest     = require('restler');
const _        = require('lodash');
const io       = require('redis.io');
const jobs     = io.createQueue({
  prefix: '4redis',
  disableSearch: true,
  jobEvents: false,
  redis: {
    host: process.env.redis
  }
});
const async    = require('async');
const csv      = require('fast-csv');

jobs.watchStuckJobs();

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
  rest.get('http://kladr-api.ru/api.php', {
    query:{
      query: region,
      contentType: 'region',
      withParent: '1',
      limit: '1',
      token: process.env.kladrtoken,
      key: process.env.kladrkey
    }
  }).once('complete', function(kladr) {
    if (kladr instanceof Error) {
      console.log('Error: ' + kladr.message);
      res.setHeader('Content-Type', 'application/javascript');
      res.send(req.query.callback + '({error: \'Current carrier is not available!\'})');
    } else {
      console.log(kladr);
      if (kladr['result'][0] == '') {
        console.log('Не опознан регион: ' + region);
        res.setHeader('Content-Type', 'application/javascript');
        res.send(req.query.callback + '({error: \'Current carrier is not available!\'})');
      } else {
        // идём по массиву данных из output.json и сравниваем есть ли нужный регион
        async.eachSeries(jobj, function(item, callback) {
          console.log(item.reg_okato);
          console.log(kladr['result'][0]['okato']);
          if ((item.reg_okato == kladr['result'][0]['okato'])||(item.okato == kladr['result'][0]['okato'])) {
            console.log('Регион опознан: ' + kladr['result'][0]['name']);
            price = item.weight[weightEqual.toString().replace('.', ',')][1];
            // ищем город в кладре, также нужен окато. Город нужен чтобы понять куда доставлять, в областной центр или область
            rest.get('http://kladr-api.ru/api.php', {
              query: {
                query: city,
                contentType: 'city',
                withParent: '1',
                limit: '1',
                token: process.env.kladrtoken,
                key: process.env.kladrkey
              }
            }).once('complete', function(kladr_city) {
              if (kladr_city instanceof Error) {
                console.log('Error: ' + kladr_city.message);
                res.setHeader('Content-Type', 'application/javascript');
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
            res.setHeader('Content-Type', 'application/javascript');
            res.send(req.query.callback + '({error: \'Current carrier is not available!\'})');
          } else {
            // возвращаем цену
            if (price == '') {
              res.setHeader('Content-Type', 'application/javascript');
              res.send(req.query.callback + '({error: \'Current carrier is not available!\'})');
            } else {
              res.setHeader('Content-Type', 'application/javascript');
              res.send(req.query.callback + '({delivery_price: ' + price + '})');
            }
          }
        });
      }
    }
  });
};

router.get('/update', (req, res) => {
  jobs.create('getTariffs')
    .priority('normal')
    .removeOnComplete(true)
    .save();
  res.send('Тарифы будут обновлены в течении пары минут');
});

let findPrice = (input, callback) => {
  console.log(input.data);
  callback(null, 'fuck2');
};

router.get('/', function(req, res) {
  if (_.isEmpty(req.query)) {
    res.sendStatus(200);
  } else {
    let region = req.
          query.
          region.
          replace(/^[а-яА-Я]{1,10}\s/g, '').
          toLowerCase();
    let city = req.
          query.
          city.
          toLowerCase();

    console.log('Регион : ' + req.query.region +
                '\nГород : ' + req.query.city +
                '\nВес : ' + req.query.weight);

    if (+req.query.zip !== 0) {
      fs.readFile(__dirname + '/../public/output.json',
                  'utf8', (err, data) => {
                    if (err) {

                    } else {
                      rest.get('http://postindexapi.ru/' + req.query.zip + '.json').once('complete', function(zip) {
                        if (zip.error_message) {
                          f(res, req, region, city, data);
                        } else {
                          var reg = zip.region.replace(/\s[а-яА-Я]{1,20}$/g, '').toLowerCase();
                          var cit = zip.city.toLowerCase();
                          if (cit == '') {
                            f(res, req, reg, city, data);
                          } else {
                            f(res, req, reg, cit, data);
                          }
                        }
                      });
                    }
      });
    } else {
      fs.readFile(__dirname + '/../public/output.json',
                  'utf8', function (err, data) {
                    if (err) {
                      res.status(500).send({error: err});
                    } else {
                      f(res, req, region, city, data);
                      // findPrice({
                      //   weight: +req.query.weight,
                      //   region: region,
                      //   city: city,
                      //   data: JSON.parse(data)
                      // }, (e, o) => {
                      //   console.log(o);
                      //   res.sendStatus(200);
                      // });
                    }
                  });
    }
  }
});

let combine = (input, callback) => {
  let priceWeight = {};
  let output = [];
  async.eachSeries(input.data.cities, function(row, callbackCities) {
    async.eachSeries(input.data.tariffs, function(i, callbackTariffs) {
      switch (row[1]) {
      case 'м':
        priceWeight[i[0]] = [parseFloat(i[2]), parseFloat(i[5])];
        setImmediate(callbackTariffs);
        break;
      case 'п':
        priceWeight[i[0]] = [parseFloat(i[1]), parseFloat(i[3])];
        setImmediate(callbackTariffs);
        break;
      case '1':
        priceWeight[i[0]] = [parseFloat(i[4]), parseFloat(i[5])];
        setImmediate(callbackTariffs);
        break;
      case '2':
        priceWeight[i[0]] = [parseFloat(i[6]), parseFloat(i[7])];
        setImmediate(callbackTariffs);
        break;
      case '3':
        priceWeight[i[0]] = [parseFloat(i[8]), parseFloat(i[9])];
        setImmediate(callbackTariffs);
        break;
      case '4':
        priceWeight[i[0]] = [parseFloat(i[10]), parseFloat(i[11])];
        setImmediate(callbackTariffs);
        break;
      case '5':
        priceWeight[i[0]] = [parseFloat(i[12]), parseFloat(i[13])];
        setImmediate(callbackTariffs);
        break;
      case '6':
        priceWeight[i[0]] = [parseFloat(i[14]), parseFloat(i[15])];
        setImmediate(callbackTariffs);
        break;
      default:
        setImmediate(callbackTariffs);
      }
    }, function(err) {
      output.push({
        name: row[0].toLowerCase(),
        weight: priceWeight
      });
      priceWeight = null;
      priceWeight = {};
      setImmediate(callbackCities);
    });
  }, function(err) {
    callback(output);
  });
};

let createFile = (cities, callback) => {
  let output = [];
  async.eachSeries(cities, function(i, cb) {
    let options = {
      url: 'http://kladr-api.ru/api.php',
      json: true,
      qs: {
        query: i.name,
        contentType: 'city',
        withParent: '1',
        limit: '1',
        token: process.env.kladrtoken,
        key: process.env.kladrkey
      }
    };
    request.get(options, (error, response, body) => {
      switch(i.name.toLowerCase()) {
      case 'москва':
        output.push({
          name: i.name,
          kladr_name: body.result[0].name.toLowerCase(),
          okato: body.result[0].okato,
          kladr_regfullname: 'московская область',
          kladr_regname: 'московская',
          reg_okato: '46000000000',
          weight: i.weight
        });
        console.log(' done > ' + i.name);
        setImmediate(cb);
        break;
      case 'санкт-петербург':
        output.push({
          name: i.name,
          kladr_name: body.result[0].name.toLowerCase(),
          okato: body.result[0].okato,
          kladr_regfullname: 'ленинградская область',
          kladr_regname: 'ленинградская',
          reg_okato: '41000000000',
          weight: i.weight
        });
        console.log(' done > ' + i.name);
        setImmediate(cb);
        break;
      default:
        output.push({
          name: i.name,
          kladr_name: body.result[0].name.toLowerCase(),
          okato: body.result[0].okato,
          kladr_regfullname: body.result[0].parents[0].name.toLowerCase() + ' ' + body.result[0].parents[0].type.toLowerCase(),
          kladr_regname: body.result[0].parents[0].name.toLowerCase(),
          reg_okato: body.result[0].parents[0].okato,
          weight: i.weight
        });
        console.log(' done > ' + i.name);
        setImmediate(cb);
      }
    });
  }, (err) => {
    if (err) {
      console.log(err);
    } else {
      fs.writeFile(__dirname + '/../public/output.json',
                   JSON.stringify(output), (err) => {
                     if(err) {
                       console.log(err);
                     } else {
                       console.log('The file was saved!');
                       setImmediate(callback);
                     }
                   });
    }
  });
};

let csvParse = (filename, callback) => {
  let output = [];
  let stream = fs.createReadStream(__dirname + '/../public/'+ filename + '.csv');

  let csvStream = csv({
    delimiter: ';',
    escape: '"'
  }).on('error', (error) => {
    console.log('Error: ' + error);
  }).on('data', (data) => {
    output.push(data);
  }).on('finish', () => {
    callback(output);
  });

  stream.pipe(csvStream);
};

let download = (filename, callback) => {
  let r = request
        .get('http://master-angel.ru/' + filename + '.csv')
        .on('response', (response) => {
          console.log(response.statusCode + '\n'
                      + response.headers['content-type'] + '\n'
                      + 'Download ' + filename + '.csv');
        })
        .pipe(fs.createWriteStream(__dirname + '/../public/' + filename + '.csv'));
  r.on('finish', () => {
    callback();
  });
};

jobs.process('getTariffs', (job, done) => {
  let domain = require('domain').create();
  domain.on('error', (err) => {
    setImmediate(done);
  });
  domain.run(() => {
    download('tariffs', () => {
      jobs.create('parseTariffs')
        .priority('normal')
        .removeOnComplete(true)
        .save();
      setImmediate(done);
    });
  });
});

jobs.process('parseTariffs', (job, done) => {
  let domain = require('domain').create();
  domain.on('error', (err) => {
    setImmediate(done);
  });
  domain.run(() => {
    csvParse('tariffs', (o) => {
      jobs.create('getCities', {
        tariffs: o
      })
        .priority('normal')
        .removeOnComplete(true)
        .save();
      setImmediate(done);
    });
  });
});

jobs.process('getCities', (job, done) => {
  let domain = require('domain').create();
  domain.on('error', (err) => {
    setImmediate(done);
  });
  domain.run(() => {
    download('cities', () => {
      jobs.create('parseCities', {
        tariffs: job.data.tariffs
      })
        .priority('normal')
        .removeOnComplete(true)
        .save();
      setImmediate(done);
    });
  });
});

jobs.process('parseCities', (job, done) => {
  let domain = require('domain').create();
  domain.on('error', (err) => {
    setImmediate(done);
  });
  domain.run(() => {
    csvParse('cities', (o) => {
      jobs.create('combineTariffs', {
        tariffs: job.data.tariffs,
        cities: o
      })
        .priority('normal')
        .removeOnComplete(true)
        .save();
      setImmediate(done);
    });
  });
});

jobs.process('combineTariffs', (job, done) => {
  let domain = require('domain').create();
  domain.on('error', (err) => {
    setImmediate(done);
  });
  domain.run(() => {
    combine(job, (o) => {
      jobs.create('kladr', {
        cities: o
      })
        .priority('normal')
        .removeOnComplete(true)
        .save();
      setImmediate(done);
    });
  });
});

jobs.process('kladr', (job, done) => {
  let domain = require('domain').create();
  domain.on('error', (err) => {
    setImmediate(done);
  });
  domain.run(() => {
    createFile(job.data.cities, () => {
      setImmediate(done);
    });
  });
});

module.exports = router;
