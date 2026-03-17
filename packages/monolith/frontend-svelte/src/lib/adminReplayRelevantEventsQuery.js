import { nanoid } from 'nanoid';
import { getLogger } from '@lazyapps/logger';
import { getPublishedMqEmitter } from '@lazyapps/mqemitter';

export const adminReplayRelevantEventsQuery = (correlationId, readModelName) => {
  const queryId = nanoid();
  const log = getLogger('Svelte/ADM/RRE', correlationId);

  return Promise.resolve(
    getPublishedMqEmitter(correlationId, process.env.MQ_QUERIES_PORT),
  ).then((mq) => {
    const replyTopic = `adminReplayRelevantEventsQueryResult/${queryId}`;
    log.debug(`Admin replayRelevantEvents query for ${readModelName} (reply ${replyTopic})`);

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`[${correlationId}] Admin replayRelevantEvents query timed out`));
      }, 10000);

      const handler = ({ payload }, cb) => {
        log.debug(`Admin replayRelevantEvents query result received (reply ${replyTopic})`);
        clearTimeout(timeout);
        mq.removeListener(replyTopic, handler);
        resolve(payload.result);
        cb();
      };

      mq.on(replyTopic, handler, () => {
        mq.emit({
          topic: 'adminReplayRelevantEventsQuery',
          payload: {
            correlationId,
            replyTopic,
            readModelName,
          },
        });
      });
    }).catch((err) => {
      log.error(`Admin replayRelevantEvents query failed (reply ${replyTopic}): ${err}`);
      throw err;
    });
  });
};
