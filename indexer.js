const algoliasearch = require('algoliasearch@3.10.2');
const _ = require('lodash@4.8.2');
const moment = require('moment@2.11.2');

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

const responseTemplate = _.template("I found <%= nbHits %> messages in <%= processingTimeMS %>ms!");
const responseItemTemplate = _.template("<%= date %>: <%= text %>")
const findMessages = function(index, terms, cb) {
  index.search(terms, {
    highlightPreTag: '*',
    highlightPostTag: '*​',
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

module.exports = function (context, cb) {
  var client = algoliasearch(context.secrets.ALGOLIA_APP_ID, context.secrets.ALGOLIA_API_KEY);
  var index = client.initIndex('auth0_slack_messages');
  index.setSettings({
    highlightPreTag: '*',
    highlightPostTag: '*​',
    hitsPerPage: 5,
    ranking: [
      'desc(event_ts)',
      "typo",
      "geo",
      "words",
      "filters",
      "proximity",
      "attribute",
      "exact",
      "custom"
      ],
    customRanking: [
      'desc(event_ts)'
      ]
  });
  
  var event = context.data.event || {};
  
  if(context.data.token != context.secrets.SLACK_VERIFICATION_TOKEN) {
    return cb({error: "NOT FROM SLACK"});
  }
  
  if(event.type == "message") {
    indexMessage(index, event, cb);
  } else if (context.data.command == '/history') {
    findMessages(index, context.data.text, cb)
  }
}
