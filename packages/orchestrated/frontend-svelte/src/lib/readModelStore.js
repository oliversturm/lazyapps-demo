import { readable } from 'svelte/store';
import io from 'socket.io-client';

const applyChange = (data, changeInfo) => {
	switch (changeInfo.changeKind) {
		case 'addRow':
			if (changeInfo.details.id && data.some((row) => row.id === changeInfo.details.id)) {
				return data;
			}
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

// Persistent socket connections shared across all stores, keyed by endpoint URL.
// Survives SvelteKit page navigations so change notifications are never missed.
const connections = new Map();

const getConnection = (socketIoEndpoint) => {
	if (connections.has(socketIoEndpoint)) {
		return connections.get(socketIoEndpoint);
	}
	const socket = io(socketIoEndpoint);
	const entry = { socket, stores: new Set() };

	socket.on('connect', () => {
		const registrations = [...entry.stores].map((s) => s.registration);
		if (registrations.length > 0) {
			socket.emit('register', registrations, () => {
				entry.stores.forEach((s) => s.onReady());
			});
		}
	});

	socket.on('change', (changeInfo) => {
		entry.stores.forEach((s) => s.onChange(changeInfo));
	});

	connections.set(socketIoEndpoint, entry);
	return entry;
};

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

		const conn = getConnection(socketIoEndpoint);

		const storeEntry = {
			registration: { endpointName, readModelName, resolverName },
			onReady: () => runQuery(),
			onChange: (changeInfo) => {
				if (!innerItems) return;
				if (
					changeInfo.endpointName !== endpointName ||
					changeInfo.readModelName !== readModelName ||
					changeInfo.resolverName !== resolverName
				) {
					return;
				}
				if (changeInfo.changeKind === 'all') {
					runQuery();
				} else {
					innerItems = applyChange(innerItems, changeInfo);
					set(wrapData(innerItems));
				}
			}
		};

		conn.stores.add(storeEntry);

		if (conn.socket.connected) {
			conn.socket.emit('register', [storeEntry.registration], () => runQuery());
		}

		return () => {
			conn.stores.delete(storeEntry);
		};
	});
	return store;
};
