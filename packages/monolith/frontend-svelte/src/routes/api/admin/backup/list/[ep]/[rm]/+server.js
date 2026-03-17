import { json } from '@sveltejs/kit';
import { adminBackupListQuery } from '$lib/adminBackupListQuery.js';
import { nanoid } from 'nanoid';

export const GET = ({ params }) => {
  const correlationId = `ADM-BK-${nanoid()}`;
  return adminBackupListQuery(correlationId, params.rm).then((result) =>
    json(result),
  );
};
