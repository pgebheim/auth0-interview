const algoliasearch = require('algoliasearch@3.10.2');
const _ = require('lodash@4.8.2');
const moment = require('moment@2.11.2');

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

// Main handler, distringuises between slash command (/history) and a message payload
module.exports = function (context, cb) {
  var client = algoliasearch(context.secrets.ALGOLIA_APP_ID, context.secrets.ALGOLIA_API_KEY);
  var index = client.initIndex('auth0_slack_messages');
  var event = context.data.event || {};
  
  // Slack will send us a verification code if its for this particular app
  // check for this so we're not just going to be receiving random data.
  if(context.data.token != context.secrets.SLACK_VERIFICATION_TOKEN) {
    return cb({error: "NOT FROM SLACK"});
  }
  
  if(event.type == "message") {
    indexMessage(index, event, cb);
  } else if (context.data.command == '/history') {
    findMessages(index, context.data.text, cb)
  }
}
