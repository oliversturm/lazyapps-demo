import { nanoid } from 'nanoid';
import { getLogger } from '@lazyapps/logger';
import { getPublishedMqEmitter } from '@lazyapps/mqemitter';

// Request/reply over the shared 'commands' mqemitter to fetch the current
// Command Processor status. The CP-side handler lives in
// @lazyapps/mqemitter/commandReceiverMqEmitter (adminCpStatusQuery). This is
// the CP analog of adminStatusQuery.js for read models (issue #23).
export const adminCpStatusQuery = (correlationId) => {
	const queryId = nanoid();
	const log = getLogger('Svelte/ADM/CpStatus', correlationId);

	return Promise.resolve(getPublishedMqEmitter(correlationId, process.env.MQ_COMMANDS_PORT)).then(
		(mq) => {
			const replyTopic = `adminCpStatusQueryResult/${queryId}`;
			log.debug(`Admin CP status query (reply ${replyTopic})`);

			return new Promise((resolve, reject) => {
				const timeout = setTimeout(() => {
					reject(new Error(`[${correlationId}] Admin CP status query timed out`));
				}, 10000);

				const handler = ({ payload }, cb) => {
					log.debug(`Admin CP status query result received (reply ${replyTopic})`);
					clearTimeout(timeout);
					mq.removeListener(replyTopic, handler);
					resolve(payload.result);
					cb();
				};

				mq.on(replyTopic, handler, () => {
					mq.emit({
						topic: 'adminCpStatusQuery',
						payload: {
							correlationId,
							replyTopic
						}
					});
				});
			}).catch((err) => {
				log.error(`Admin CP status query failed (reply ${replyTopic}): ${err}`);
				throw err;
			});
		}
	);
};
