import { nanoid } from 'nanoid';
import { getLogger } from '@lazyapps/logger';
import { getPublishedMqEmitter } from '@lazyapps/mqemitter';

export const adminQuery = (correlationId) => {
  const queryId = nanoid();
  const log = getLogger('Svelte/ADM', correlationId);

  return Promise.resolve(
    getPublishedMqEmitter(correlationId, process.env.MQ_QUERIES_PORT),
  ).then((mq) => {
    const replyTopic = `adminQueryResult/${queryId}`;
    log.debug(`Admin query (reply ${replyTopic})`);

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`[${correlationId}] Admin query timed out`));
      }, 10000);

      const handler = ({ payload }, cb) => {
        log.debug(`Admin query result received (reply ${replyTopic})`);
        clearTimeout(timeout);
        mq.removeListener(replyTopic, handler);
        resolve(payload.result);
        cb();
      };

      // Subscribe to the reply topic BEFORE emitting the query to avoid
      // a race condition: mqemitter-cs processes requests in order, so the
      // server-side handler could emit the reply before the subscription
      // is active if we emit first.
      mq.on(replyTopic, handler, () => {
        mq.emit({
          topic: 'adminQuery',
          payload: {
            correlationId,
            replyTopic,
          },
        });
      });
    }).catch((err) => {
      log.error(`Admin query failed (reply ${replyTopic}): ${err}`);
      throw err;
    });
  });
};
