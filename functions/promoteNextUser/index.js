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

  try {
    // 1. Obtener el documento del usuario activo (siempre debe existir uno)
    const activeUserResponse = await databases.listDocuments(DATABASE_ID, COLLECTIONS.ACTIVE_USER, [Query.limit(1)]);
    if (activeUserResponse.documents.length === 0) {
      throw new Error("El documento del usuario activo no existe en la base de datos.");
    }
    const activeUserDoc = activeUserResponse.documents[0];
    
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
    const activeSessionUserIds = new Set(sessionsResponse.documents.map(doc => doc.user_id));
    
    let nextInLine = null;

    // 4. Encontrar el primer usuario en la cola que también esté activo
    for (const userInQueue of queue) {
        if (activeSessionUserIds.has(userInQueue.user_id)) {
            nextInLine = userInQueue;
            break; // Encontramos al candidato
        } else {
            // Este usuario está en la cola pero no tiene sesión activa, lo limpiamos
            log(`Limpiando usuario inactivo de la cola: ${userInQueue.email}`);
            await databases.deleteDocument(DATABASE_ID, COLLECTIONS.QUEUE, userInQueue.$id);
        }
    }

    // 5. Si encontramos un candidato, lo promovemos
    if (nextInLine) {
      log(`Promoviendo al usuario: ${nextInLine.email}`);
      
      // Actualizar el documento de usuario activo
      await databases.updateDocument(DATABASE_ID, COLLECTIONS.ACTIVE_USER, activeUserDoc.$id, {
        user_id: nextInLine.user_id,
        email: nextInLine.email,
        is_paused: false,
        remaining_time: 900, // 15 minutos
        last_updated: new Date().toISOString(),
        pauses_used: 0
      });

      // Eliminar al usuario de la cola
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

