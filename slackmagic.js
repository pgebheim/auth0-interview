const algoliasearch = require('algoliasearch@3.10.2');
const _ = require('lodash@4.8.2');
const moment = require('moment@2.11.2');
var app = new (require('express'))();
var bodyParser = require('body-parser')

//
// Define some helper middlewares
//
const algoliaMiddleware = (req, res, next) => {
  console.log(req.webtaskContext.secrets);
  req.algolia = {};
  req.algolia.client = algoliasearch(req.webtaskContext.secrets.ALGOLIA_APP_ID, req.webtaskContext.secrets.ALGOLIA_API_KEY);
  req.algolia.index = {
    messages: req.algolia.client.initIndex('auth0_slack_messages')
  };

  next();
}

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
}

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
const indexMessage = function(index, event, cb) {
  event.event_ts = parseFloat(event.event_ts);
  index.addObject(event, event.event_id, function(err, content) {
    if(err) {
      cb(err);
    } else {
      cb(null, {objectID: content.objectID});
    }
  });
}

// Searches the algolia index, and formats a slack reply with the top 5 messages
const responseTemplate = _.template("I found <%= nbHits %> messages in <%= processingTimeMS %>ms!");
const responseItemTemplate = _.template("<%= date %>: <%= text %>")
const findMessages = function(index, terms, cb) {
  index.search(terms, {
    // insert a zero-width whitespaec character so that slack's
    // MD processor will highlight if its a part of a longer word
    highlightPreTag: '*',
    highlightPostTag: '*​', 

    // Only display 5 records for this use case
    hitsPerPage: 5
  }, function searchDone(err, content) {
    if (err) {
      return cb(err);
    }
  
    cb(null, {
      text: responseTemplate(content),
      attachments: _.map(content.hits, function(hit) {
        return {
          text: responseItemTemplate({
            text: hit._highlightResult.text.value,
            date: moment(hit.event_ts).fromNow()
          }),
          mrkdwn_in: ["text"]
        };
      })
    });
  });
}

//
// App request handlers
//
app.get('/', (req, res) => res.send('Hello World'));


app.post('/api/slack/events', (req, res) => {
  var event = req.body.event;
  var handler = null;
  
  switch(req.body.data.type) {
    case 'message':
      handler = indexMessage;
    // Add More
  }
  
  if(!handler) {
    return req.status(500).error({error: "Event type not allowed: " + req.body.event.type});
  }
  
  handler(req.algolia.index.messages, event, (err, result) => {
    if(err) {
      res.status(500).send({error: err});
    } else {
      res.send(result);
    }
  });
});


app.post('/api/slack/commands/history', (req, res) => {
  var terms = req.body.terms;

  findMessages(req.algolia.index.messages, terms, (err, result) => {
    if(err) {
      res.status(500).send({error: err});
    } else {
      res.send(result);
    }
  });
});

module.exports = app;

