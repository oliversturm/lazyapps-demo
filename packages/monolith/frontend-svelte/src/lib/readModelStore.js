import { readable } from 'svelte/store';
import io from 'socket.io-client';

const applyChange = (data, changeInfo) => {
	switch (changeInfo.changeKind) {
		case 'addRow':
			return data.concat(changeInfo.details);

		case 'updateRow':
			return data.map((row) =>
				row.id === changeInfo.details.id ? { ...row, ...changeInfo.details } : row
			);

		case 'deleteRow':
			return data.filter((row) => row.id !== changeInfo.details.id);

		default:
			return data;
	}
};

const wrapData = (data) => ({
	data,
	loaded: !!data,
	isEmpty: data && data.length === 0,
	singleItem: data?.length === 1 ? data[0] : undefined
});

export const readModelStore = (
	queryFn,
	endpointName,
	socketIoEndpoint,
	readModelName,
	resolverName,
	correlationId
) => {
	const store = readable(wrapData(null), (set) => {
		let innerItems = null;

		const runQuery = () =>
			queryFn().then((items) => {
				innerItems = items;
				set(wrapData(innerItems));
			});

		if (!socketIoEndpoint) {
			runQuery();
			return () => {};
		}

		const query = {};
		if (correlationId) {
			query.correlationId = correlationId;
		}
		const socket = io(socketIoEndpoint, { query });

		socket.on('connect', () => {
			socket.emit('register', [{ endpointName, readModelName, resolverName }], () => {
				runQuery();
			});
		});

		socket.on('change', (changeInfo) => {
			if (!innerItems) return;
			if (changeInfo.changeKind === 'all') {
				runQuery();
			} else {
				innerItems = applyChange(innerItems, changeInfo);
				set(wrapData(innerItems));
			}
		});

		return () => socket.disconnect();
	});
	return store;
};
