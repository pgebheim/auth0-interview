const algoliasearch = require('algoliasearch@3.10.2');
const _ = require('lodash@4.8.2');

const indexMessage = function(index, event, cb) {
  index.addObject(event, event.event_id, function(err, content) {
    if(err) {
      cb(err);
    } else {
      cb(null, {objectID: content.objectID});
    }
  });
}

const responseTemplate = _.template("You wanted history? We found <%= count %> in <%= processingTime %>ms!");
const findMessages = function(index, terms, cb) {
  index.search(terms, {hitsPerPage: 5, attributesToHighlight: ['text']}, function searchDone(err, content) {
    if (err) {
      return cb(err);
    }
  
    console.log(content);
    cb(null, {
      text: responseTemplate({count: content.nbHits, processingTime: content.processingTimeMS}),
      attachments: _.map(content.hits, function(hit) {
        return {
          text: hit.text
        };
      })
    });
  });
}

module.exports = function (context, cb) {
  var client = algoliasearch(context.secrets.ALGOLIA_APP_ID, context.secrets.ALGOLIA_API_KEY);
  var index = client.initIndex('auth0_slack_messages');
  var event = context.data.event || {};
  
  if(event.type == "message") {
    indexMessage(index, event, cb);
  } else if (context.data.command == '/history') {
    findMessages(index, context.data.text, cb)
  }
}
