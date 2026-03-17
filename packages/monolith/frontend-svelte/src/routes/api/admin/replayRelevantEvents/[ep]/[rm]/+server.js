import { json } from '@sveltejs/kit';
import { adminReplayRelevantEventsQuery } from '$lib/adminReplayRelevantEventsQuery.js';
import { nanoid } from 'nanoid';

export const GET = ({ params }) => {
  const { rm } = params;
  return adminReplayRelevantEventsQuery(`ADM-${nanoid()}`, rm).then((result) =>
    json(result),
  );
};
