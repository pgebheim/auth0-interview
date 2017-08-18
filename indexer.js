var algoliasearch = require('algoliasearch@3.10.2');

const indexMessage = function(event, cb) {
  index.addObject(event, event.event_id, function(err, content) {
    if(err) {
      cb(err);
    } else {
      cb(null, {objectID: content.objectID});
    }
  });
}

const findMessages = function(terms, cb) {
  
}

module.exports = function (context, cb) {
  var client = algoliasearch(context.secrets.ALGOLIA_APP_ID, context.secrets.ALGOLIA_API_KEY);
  var index = client.initIndex('auth0_slack_messages');
  
  if(context.data.event.type == "message") {
    indexMessage(context.data.event);
  } else {
    console.log(context);
  }
}
