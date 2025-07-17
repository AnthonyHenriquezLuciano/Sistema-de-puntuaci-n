import { Client, Databases, Query } from 'node-appwrite';

export default async ({ res, log, error }) => {
  const client = new Client()
    .setEndpoint(process.env.APPWRITE_FUNCTION_ENDPOINT)
    .setProject(process.env.APPWRITE_FUNCTION_PROJECT_ID)
    .setKey(process.env.APPWRITE_API_KEY);

  const databases = new Databases(client);

  const DATABASE_ID = 'turnos_db';
  const COLLECTIONS = {
      QUEUE: '68786591001d1f8ebf65',
      ACTIVE_USER: '6878665f001083c0cb2f'

  try {
    const activeUserResponse = await databases.listDocuments(DATABASE_ID, COLLECTIONS.ACTIVE_USER, [Query.limit(1)]);
    const activeUserDoc = activeUserResponse.documents[0];

    if (activeUserDoc && activeUserDoc.userId) {
      log('Puesto de turno activo ya está ocupado.');
      return res.json({ success: false, message: 'Puesto ocupado.' });
    }

    const queueResponse = await databases.listDocuments(DATABASE_ID, COLLECTIONS.QUEUE, [Query.orderAsc('joinedAt'), Query.limit(1)]);
    if (queueResponse.documents.length === 0) {
      log('La cola está vacía.');
      return res.json({ success: true, message: 'Cola vacía.' });
    }
    const nextInLine = queueResponse.documents[0];

    await databases.updateDocument(DATABASE_ID, COLLECTIONS.ACTIVE_USER, activeUserDoc.$id, {
        userId: nextInLine.userId,
        email: nextInLine.email,
        isPaused: false,
        remainingTime: 900,
        lastUpdated: Date.now(),
        pausesUsed: 0
    });

    await databases.deleteDocument(DATABASE_ID, COLLECTIONS.QUEUE, nextInLine.$id);

    log(`Usuario ${nextInLine.email} promovido.`);
    return res.json({ success: true, userPromoted: nextInLine.email });

  } catch (e) {
    error(e);
    return res.json({ success: false, error: e.message }, 500);
  }
};
