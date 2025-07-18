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
  };

  try {
    // 1. Obtener el documento del usuario activo (siempre debe existir uno)
    const activeUserResponse = await databases.listDocuments(DATABASE_ID, COLLECTIONS.ACTIVE_USER, [Query.limit(1)]);
    if (activeUserResponse.documents.length === 0) {
      throw new Error("El documento del usuario activo no existe en la base de datos.");
    }
    const activeUserDoc = activeUserResponse.documents[0];
    
    // 2. Si el turno ya está ocupado, no hacer nada
    if (activeUserDoc.userId) {
      log('El turno ya está ocupado.');
      return res.json({ success: false, message: 'Turno ocupado.' });
    }
    
    // 3. Obtener el siguiente usuario de la cola
    const queueResponse = await databases.listDocuments(DATABASE_ID, COLLECTIONS.QUEUE, [Query.orderAsc('joined_at'), Query.limit(1)]);
    if (queueResponse.documents.length === 0) {
      log('La cola está vacía.');
      return res.json({ success: true, message: 'Cola vacía.' });
    }
    const nextInLine = queueResponse.documents[0];

    // 4. Actualizar el documento de usuario activo con los datos del siguiente en la cola
    await databases.updateDocument(DATABASE_ID, COLLECTIONS.ACTIVE_USER, activeUserDoc.$id, {
      userId: nextInLine.user_id,
      email: nextInLine.email,
      isPaused: false,
      remainingTime: 900, // 15 minutos
      lastUpdated: new Date().toISOString(),
      pausesUsed: 0
    });

    // 5. Eliminar al usuario de la cola
    await databases.deleteDocument(DATABASE_ID, COLLECTIONS.QUEUE, nextInLine.$id);
    
    log(`Usuario ${nextInLine.email} promovido.`);
    return res.json({ success: true, userPromoted: nextInLine.email });

  } catch (e) {
    error(`Error en la función de promoción: ${e.message}`);
    return res.json({ success: false, error: e.message }, 500);
  }
};
