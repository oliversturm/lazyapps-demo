export const queryClient = (readModelName, resolverName, params = {}) =>
	fetch(`/api/query/${readModelName}/${resolverName}`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(params)
	}).then((res) => {
		if (!res.ok) throw new Error(`Query failed: ${res.status}`);
		return res.json();
	});
