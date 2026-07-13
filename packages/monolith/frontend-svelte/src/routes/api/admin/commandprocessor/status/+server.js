import { json } from '@sveltejs/kit';
import { adminCpStatusQuery } from '$lib/adminCpStatusQuery.js';
import { nanoid } from 'nanoid';

// Bridges the admin-api's HTTP CP-status fetch to the in-process 'commands'
// mqemitter (issue #23). Mirrors the express command receiver's
// /admin/commandprocessor/status endpoint, so admin-api needs no changes.
export const GET = () => adminCpStatusQuery(`ADM-CP-${nanoid()}`).then((result) => json(result));
