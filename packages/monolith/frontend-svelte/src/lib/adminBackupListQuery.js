import { nanoid } from 'nanoid';
import { getLogger } from '@lazyapps/logger';
import { getPublishedMqEmitter } from '@lazyapps/mqemitter';

export const adminBackupListQuery = (correlationId, readModelName) => {
  const queryId = nanoid();
  const log = getLogger('Svelte/ADM/Backup', correlationId);

  return Promise.resolve(
    getPublishedMqEmitter(correlationId, process.env.MQ_QUERIES_PORT),
  ).then((mq) => {
    const replyTopic = `adminBackupListResult/${queryId}`;
    log.debug(
      `Admin backup list query for ${readModelName} (reply ${replyTopic})`,
    );

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(
          new Error(`[${correlationId}] Admin backup list query timed out`),
        );
      }, 10000);

      const handler = ({ payload }, cb) => {
        log.debug(
          `Admin backup list result received (reply ${replyTopic})`,
        );
        clearTimeout(timeout);
        mq.removeListener(replyTopic, handler);
        resolve(payload.result);
        cb();
      };

      mq.on(replyTopic, handler, () => {
        mq.emit({
          topic: 'adminBackupListQuery',
          payload: {
            correlationId,
            replyTopic,
            readModelName,
          },
        });
      });
    }).catch((err) => {
      log.error(
        `Admin backup list query failed (reply ${replyTopic}): ${err}`,
      );
      throw err;
    });
  });
};
