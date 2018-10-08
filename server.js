const slackEventsApi = require('@slack/events-api');
const SlackClient = require('@slack/client').WebClient;
const passport = require('passport');
const SlackStrategy = require('@aoberoi/passport-slack').default.Strategy;
const http = require('http');
const express = require('express');

// *** Initialize event adapter using signing secret from environment variables ***
const slackEvents = slackEventsApi.createEventAdapter(process.env.SLACK_SIGNING_SECRET, {
  includeBody: true
});

// Initialize a data structures to store team authorization info (typically stored in a database)
const botAuthorizations = {}

// Helpers to cache and lookup appropriate client
// NOTE: Not enterprise-ready. if the event was triggered inside a shared channel, this lookup
// could fail but there might be a suitable client from one of the other teams that is within that
// shared channel.
const clients = {};
function getClientByTeamId(teamId) {
  if (!clients[teamId] && botAuthorizations[teamId]) {
    clients[teamId] = new SlackClient(botAuthorizations[teamId]);
  }
  if (clients[teamId]) {
    return clients[teamId];
  }
  return null;
}

// Initialize Add to Slack (OAuth) helpers
passport.use(new SlackStrategy({
  clientID: process.env.SLACK_CLIENT_ID,
  clientSecret: process.env.SLACK_CLIENT_SECRET,
  skipUserProfile: true,
}, (accessToken, scopes, team, extra, profiles, done) => {
  botAuthorizations[team.id] = extra.bot.accessToken;
  done(null, {});
}));

// Initialize an Express application
const app = express();

// Plug the Add to Slack (OAuth) helpers into the express app
app.use(passport.initialize());
app.get('/', (req, res) => {
  res.send('<a href="/auth/slack"><img alt="Add to Slack" height="40" width="139" src="https://platform.slack-edge.com/img/add_to_slack.png" srcset="https://platform.slack-edge.com/img/add_to_slack.png 1x, https://platform.slack-edge.com/img/add_to_slack@2x.png 2x" /></a>');
});
app.get('/auth/slack', passport.authenticate('slack', {
  scope: ['bot']
}));
app.get('/auth/slack/callback',
  passport.authenticate('slack', { session: false }),
  (req, res) => {
    res.send('<p>Greet and React was successfully installed on your team.</p>');
  },
  (err, req, res, next) => {
    res.status(500).send(`<p>Greet and React failed to install</p> <pre>${err}</pre>`);
  }
);

// *** Plug the event adapter into the express app as middleware ***
app.use('/slack/events', slackEvents.expressMiddleware());

// *** Attach listeners to the event adapter ***

// *** Greeting any user that says "hi" ***
slackEvents.on('message', (message, body) => {

  console.log(message);
  console.log(body);

  // Only deal with messages that have no subtype (plain messages) and contain 'hi'
  if (!message.subtype && message.text.indexOf('hi') >= 0) {
    // Initialize a client
    const slack = getClientByTeamId(body.team_id);
    // Handle initialization failure
    if (!slack) {
      return console.error('No authorization found for this team. Did you install this app again after restarting?');
    }
    // Respond to the message back in the same channel
    handleSlackMessage(SessionHandler(),message, slack);
    // slack.chat.postMessage({ channel: message.channel, text: `Hello <@${message.user}>! :tada:` })
    //   .catch(console.error);
  }
});


// *** Handle errors ***
slackEvents.on('error', (error) => {
  if (error.code === slackEventsApi.errorCodes.TOKEN_VERIFICATION_FAILURE) {
    // This error type also has a `body` propery containing the request body which failed verification.
    console.error(`An unverified request was sent to the Slack events Request URL. Request body: \
${JSON.stringify(error.body)}`);
  } else {
    console.error(`An error occurred while handling a Slack event: ${error.message}`);
  }
});

// Start the express application
const port = process.env.PORT || 3000;
http.createServer(app).listen(port, () => {
  console.log(`server listening on port ${port}`);
});

/* *
 * SESSION HANDLER
 * */
function SessionHandler() {
  const redisClient = redis.createClient({ prefix: 'sl', url: redisCloudUrl});

  return {
    getSession: (userId) => new Promise((resolve, reject) => {
      redisClient.get(userId, (err, res) => {
        if (err) reject(err);
        resolve(res);
      });
    }),
    setSession: (userId, sessionId) => new Promise((resolve, reject) => {
      redisClient.set(userId, sessionId, (err1) => {
        if (err1) reject(err1);

        const oneDay = 24 * 60 * 60;
        redisClient.expire(userId, oneDay, (err2) => {
          if (err2) reject(err2);
          resolve();
        });
      });
    })
  };
}

async function handleSlackMessage(sessionHandler,message,slack) {
  
  try {
    console.log(`Got message '${message.text}' from channel ${message.channel}`);

    // find engine session id mapped to channel id
    const sessionId = await sessionHandler.getSession(message.channel);

    // send message to engine using sessionId
    const teneoResponse = await teneoApi.sendInput(sessionId, {
      text: message.text
    });

    console.log(`Got Teneo Engine response '${teneoResponse.output.text}' for session ${teneoResponse.sessionId}`);

    // store mapping between channel and engine sessionId
    await sessionHandler.setSession(message.channel, teneoResponse.sessionId);

    // construct slack message with engine output text
    const slackMessage = createSlackMessage(message.channel, teneoResponse.output.text);

    // send message to slack with engine output text
    await sendSlackMessage(slackMessage,slack);

  } catch (error) {
    console.error(`Failed when sending input to Teneo Engine @ ${teneoEngineUrl}`, error);
  }

}


function createSlackMessage(channel, text) {
  return {
    message: text,
    channel: channel
  };
}

async function sendSlackMessage(messageData,slack) {
  slack.chat.postMessage({ channel: messageData.channel, text: messageData.message})
    .then((msg) => console.log(`Message sent to channel ${messageData.channel} with ts:${msg.ts}`))
    .catch(console.error);

  // rtm.sendMessage(messageData.message, messageData.channel)
  //     // Returns a promise that resolves when the message is sent
  //     .then((msg) => console.log(`Message sent to channel ${messageData.channel} with ts:${msg.ts}`))
  //     .catch(console.error);
}