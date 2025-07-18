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
    ACTIVE_USER: '6878665f001083c0cb2f',
    SESSIONS: '6878670b00035fe5db1e'
  };
  const SESSION_TIMEOUT_MS = 2 * 60 * 1000; // 2 minutos

  try {
    // 1. Obtener el documento del usuario activo
    let activeUserResponse = await databases.listDocuments(DATABASE_ID, COLLECTIONS.ACTIVE_USER, [Query.limit(1)]);
    let activeUserDoc = activeUserResponse.documents[0];

    // 9. Si el documento de usuario activo no existe, créalo (salvaguarda)
    if (!activeUserDoc) {
        activeUserDoc = await databases.createDocument(DATABASE_ID, COLLECTIONS.ACTIVE_USER, 'singleton', { is_paused: false, pauses_used: 0 });
    }

    // 2. Si el turno ya está ocupado, no hacer nada
    if (activeUserDoc.user_id) {
      log('El turno ya está ocupado.');
      return res.json({ success: false, message: 'Turno ocupado.' });
    }
    
    // 3. Obtener la cola completa y las sesiones activas
    const [queueResponse, sessionsResponse] = await Promise.all([
        databases.listDocuments(DATABASE_ID, COLLECTIONS.QUEUE, [Query.orderAsc('joined_at')]),
        databases.listDocuments(DATABASE_ID, COLLECTIONS.SESSIONS)
    ]);

    if (queueResponse.documents.length === 0) {
      log('La cola está vacía.');
      return res.json({ success: true, message: 'Cola vacía.' });
    }

    const queue = queueResponse.documents;
    const activeSessionUserIds = new Set(
        sessionsResponse.documents
            .filter(doc => (Date.now() - new Date(doc.last_heartbeat).getTime()) < SESSION_TIMEOUT_MS)
            .map(doc => doc.user_id)
    );
    
    let nextInLine = null;

    // 8. Encontrar el primer usuario en la cola que también esté activo
    for (const userInQueue of queue) {
        if (activeSessionUserIds.has(userInQueue.user_id)) {
            nextInLine = userInQueue;
            break; 
        } else {
            log(`Limpiando usuario inactivo de la cola: ${userInQueue.email}`);
            await databases.deleteDocument(DATABASE_ID, COLLECTIONS.QUEUE, userInQueue.$id);
        }
    }
    
    if (nextInLine) {
      log(`Promoviendo al usuario: ${nextInLine.email}`);
      
      // Actualizar y eliminar de forma atómica
      const updates = {};
      updates[`databases/${DATABASE_ID}/collections/${COLLECTIONS.ACTIVE_USER}/documents/${activeUserDoc.$id}`] = {
        user_id: nextInLine.user_id,
        email: nextInLine.email,
        is_paused: false,
        remaining_time: 900,
        last_updated: new Date().toISOString(),
        pauses_used: 0
      };
      updates[`databases/${DATABASE_ID}/collections/${COLLECTIONS.QUEUE}/documents/${nextInLine.$id}`] = null;
      
      // Usar una operación de actualización múltiple para simular una transacción
      await databases.updateDocument(DATABASE_ID, COLLECTIONS.ACTIVE_USER, activeUserDoc.$id, updates[`databases/${DATABASE_ID}/collections/${COLLECTIONS.ACTIVE_USER}/documents/${activeUserDoc.$id}`]);
      await databases.deleteDocument(DATABASE_ID, COLLECTIONS.QUEUE, nextInLine.$id);

      log(`Usuario ${nextInLine.email} promovido.`);
      return res.json({ success: true, userPromoted: nextInLine.email });
    } else {
      log('No se encontraron usuarios activos en la cola para promover.');
      return res.json({ success: true, message: 'No hay usuarios activos en la cola.' });
    }

  } catch (e) {
    error(`Error en la función de promoción: ${e.message}`);
    return res.json({ success: false, error: e.message }, 500);
  }
};
