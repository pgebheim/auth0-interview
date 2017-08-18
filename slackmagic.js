const algoliasearch = require('algoliasearch@3.10.2');
const _ = require('lodash@4.8.2');
const moment = require('moment@2.11.2');
const slack = require('slack@8.3.1');
const request = require('request');
const async = require('async');
const streams = require('memory-streams@0.1.2');

var app = new (require('express'))();
var bodyParser = require('body-parser');

//
// Define some helper middlewares
//
const algoliaMiddleware = (req, res, next) => {
  req.algolia = {};
  req.algolia.client = algoliasearch(req.webtaskContext.secrets.ALGOLIA_APP_ID, req.webtaskContext.secrets.ALGOLIA_API_KEY);
  req.algolia.index = {
    messages: req.algolia.client.initIndex('auth0_slack_messages')
  };

  next();
};

const slackTokenCheckMiddleware = (req, res, next) => {
  // Slack will send us a verification code if its for this particular app
  // check for this so we're not just going to be receiving random data.
  var token = req.body.token;
  if(token && token != req.webtaskContext.secrets.SLACK_VERIFICATION_TOKEN) {
    return res.status(403).send({error: "Not from slack"});
  }
  
  if(req.body.challenge) {
    return res.send({challenge: req.body.challenge});
  }
  next();
};

const readStorage = (req, res, next) => {
  if(req.body.team_id) {
    req.webtaskContext.storage.get((err, data) => {
      req.storage = data[req.team_id];
      next();
    });
  } else {
    next();
  }
};

//
// Put middleware in our middleware chain
//
app.use(bodyParser.urlencoded({extended: true}));
app.use(bodyParser.json());
app.use(algoliaMiddleware);
app.use(slackTokenCheckMiddleware);


//
// Helpers to actually index and find messages
//

// Takes an event payload from slack and submits it to the algolia index
const indexMessage = (index, event, cb) => {
  event.event_ts = parseFloat(event.event_ts);
  index.addObject(event, event.event_id, (err, content) => {
    if(err) {
      cb(err);
    } else {
      cb(null, {objectID: content.objectID});
    }
  });
};

const indexFile = (index, event, ctx, cb) => {
  if(_.includes(['png', 'jpg', 'jpeg'], event.file.filetype)) {
    console.log(event.file);
    var cache = new streams.WritableStream();
    
    ctx.storage.get((err, data) => {
      console.log(data);
      cache.on('end', () => {
        console.log('Stream full')
        console.log(cache);
      })
      
      request.get(event.file.url_private_download, {
        auth: {
          bearer: data[event.team_id].bot.bot_access_token
        }
      }).on('response', (response) => {
        cb(null, "Got File");
      }).on('end', () => {
        request.post({
          url: "http://api.havenondemand.com/1/api/sync/ocrdocument/v1",
          formData: {
            file: {
              value: new streams.ReadableStream(cache.toBuffer()),
              options: {
                contentType: event.file.contentType
              }
            },
            mode: 'document_photo',
            apiKey: ctx.secrets.HAVEN_KEY
          }
        })
      }).pipe(cache);
      
    });
  } else {
    cb(null, null);
  }
};

// Searches the algolia index, and formats a slack reply with the top 5 messages
const responseTemplate = _.template("I found <%= nbHits %> messages in <%= processingTimeMS %>ms!");
const historyTemplate = _.template("Showing the last <%= nbHits %> messages: ");
const responseItemTemplate = _.template("<%= text %>");
const findMessages = function(index, team_id, terms, cb) {
  index.search({
    query: terms,
    facetFilters: ['team_id:'+team_id]
  }, {
    // insert a zero-width whitespaec character so that slack's
    // MD processor will highlight if its a part of a longer word
    highlightPreTag: '​*',
    highlightPostTag: '*​',

    // Only display 5 records for this use case
    hitsPerPage: 5
  }, function searchDone(err, content) {
    if (err) {
      return cb(err);
    }
  
    cb(null, {
      text: (terms === "") ? historyTemplate(content) : responseTemplate(content),
      attachments: _.map(content.hits, function(hit) {
        return {
          text: responseItemTemplate({
            text: hit._highlightResult.text.value
          }),
          mrkdwn_in: ["text"]
        };
      })
    });
  });
};

//
// App request handlers
//
app.get('/', (req, res) => res.send('Hello World'));


app.post('/api/slack/events', (req, res) => {
  console.log(req.body);
  
  var event = req.body.event;
  event.team_id = req.body.team_id;
  event.event_id = req.body.event_id;
  
  
  var strategies = [];
  switch(event.type) {
    case 'message':
      strategies.push(_.partial(indexMessage, req.algolia.index.messages, event));
      break;
    // Add More
  }
  
  switch(event.subtype) {
    case "file_share":
      strategies.push(_.partial(indexFile, req.algolia.index.messages, event, req.webtaskContext));
      break;
  }
  
  if(strategies.length === 0) {
    return res.status(500).send({error: "Event type not allowed: " + event.type});
  }
  
  async.parallel(strategies, (err, result) => {
    if(err) {
      res.status(500).send({error: err});
    } else {
      res.send(result);
    }
  });
});


app.post('/api/slack/commands/search', (req, res) => {
  findMessages(req.algolia.index.messages, req.body.team_id, req.body.text, (err, result) => {
    if(err) {
      res.status(500).send({error: err});
    } else {
      res.send(result);
    }
  });
});

app.get('/api/oauth/callback', (req, res) => {
  slack.oauth.access({
    client_id: req.webtaskContext.secrets.SLACK_CLIENT_ID,
    client_secret: req.webtaskContext.secrets.SLACK_CLIENT_SECRET,
    code: req.query.code,
  }, (err, response) => {
    if(err) {
      console.log(err);
      return res.status(403).send({error: err});
    }
      
    req.webtaskContext.storage.get((err, data) => {
      data = data || {};
      data[response.team_id] = response;
      
      var attempts = 3;
      req.webtaskContext.storage.set(data, function set_cb(error) {
        if (error) {
          if (error.code === 409 && attempts--) {
            // resolve conflict and re-attempt set
            return ctx.storage.set(data, set_cb);
          }
          
          return res.status(500).send({error: "Did not authorize user properly, try again"});
        }
        
        res.send("Authorized -- Go invite @indexer_bot into a channel");
      });
    });
  });
});

module.exports = app;