import { nanoid } from 'nanoid';
import { getToken } from './auth';

const commandEndpoint = import.meta.env.VITE_COMMAND_URL || 'http://127.0.0.1:3001/api/command';
const ordersReadModelEndpoint = import.meta.env.VITE_RM_ORDERS_URL || 'http://127.0.0.1:3005';

// Same code as React
const _postCommand = (endpoint, content) => {
	const correlationId = `SVLT-${nanoid()}`;
	content.correlationId = correlationId;
	const headers = { 'Content-Type': 'application/json' };
	const token = getToken();
	if (token) headers['Authorization'] = `Bearer ${token}`;
	return fetch(endpoint, {
		method: 'POST',
		headers,
		body: JSON.stringify(content)
	})
		.then((res) => {
			if (!res.ok) {
				throw new Error(`Fetch error: ${res.status}/${res.statusText}`);
			}
			return res;
		})
		.catch((err) => {
			console.error(
				`Can't post command to ${endpoint} with content ${JSON.stringify(content)}: ${err}`
			);
		});
};

export const postCommand = (content) => _postCommand(commandEndpoint, content);

const queryOrders = (customerId) => {
	const headers = { 'Content-Type': 'application/json' };
	const token = getToken();
	if (token) headers['Authorization'] = `Bearer ${token}`;
	return fetch(new URL('/query/overview/all', ordersReadModelEndpoint), {
		method: 'POST',
		headers,
		body: JSON.stringify({})
	})
		.then((res) => res.json())
		.then((orders) => orders.filter((o) => o.customerId === customerId));
};

export const forgetSubject = (subjectId) =>
	postCommand({
		aggregateName: 'customer',
		aggregateId: subjectId,
		command: 'FORGET_SUBJECT',
		payload: { subjectId }
	}).then(() =>
		queryOrders(subjectId).then((orders) =>
			Promise.all(
				orders.map((order) =>
					postCommand({
						aggregateName: 'order',
						aggregateId: order.id,
						command: 'FORGET_RELATED_SUBJECT',
						payload: {
							relatedSubjectId: subjectId,
							relatedSubjectType: 'customer',
							contexts: ['personal']
						}
					})
				)
			)
		)
	);
