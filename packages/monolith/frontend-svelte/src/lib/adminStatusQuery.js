import { nanoid } from 'nanoid';
import { getLogger } from '@lazyapps/logger';
import { getPublishedMqEmitter } from '@lazyapps/mqemitter';

export const adminStatusQuery = (correlationId, endpointName, readModelName) => {
  const queryId = nanoid();
  const log = getLogger('Svelte/ADM/Status', correlationId);

  return Promise.resolve(
    getPublishedMqEmitter(correlationId, process.env.MQ_QUERIES_PORT),
  ).then((mq) => {
    const replyTopic = `adminStatusQueryResult/${queryId}`;
    log.debug(`Admin status query for ${endpointName}/${readModelName} (reply ${replyTopic})`);

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`[${correlationId}] Admin status query timed out`));
      }, 10000);

      const handler = ({ payload }, cb) => {
        log.debug(`Admin status query result received (reply ${replyTopic})`);
        clearTimeout(timeout);
        mq.removeListener(replyTopic, handler);
        resolve(payload.result);
        cb();
      };

      mq.on(replyTopic, handler, () => {
        mq.emit({
          topic: 'adminStatusQuery',
          payload: {
            correlationId,
            replyTopic,
            endpointName,
            readModelName,
          },
        });
      });
    }).catch((err) => {
      log.error(`Admin status query failed (reply ${replyTopic}): ${err}`);
      throw err;
    });
  });
};
