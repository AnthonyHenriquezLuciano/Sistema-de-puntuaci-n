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
    // Verificar si hay usuario activo
    const activeUserResponse = await databases.listDocuments(DATABASE_ID, COLLECTIONS.ACTIVE_USER, [Query.limit(1)]);
    const activeUserDoc = activeUserResponse.documents[0];
    
    // Si hay usuario activo, no hacer nada
    if (activeUserDoc && activeUserDoc.userId) {
      log('Ya hay un usuario activo en turno.');
      return res.json({ success: false, message: 'Ya hay usuario activo.' });
    }
    
    // Buscar siguiente en la cola
    const queueResponse = await databases.listDocuments(DATABASE_ID, COLLECTIONS.QUEUE, [
      Query.orderAsc('joinedAt'), 
      Query.limit(1)
    ]);
    
    if (queueResponse.documents.length === 0) {
      log('La cola está vacía, no hay nadie para promover.');
      return res.json({ success: true, message: 'Cola vacía.' });
    }
    
    const nextInLine = queueResponse.documents[0];
    
    // Promover al siguiente usuario
    if (activeUserDoc) {
      // Actualizar documento existente
      await databases.updateDocument(DATABASE_ID, COLLECTIONS.ACTIVE_USER, activeUserDoc.$id, {
        userId: nextInLine.userId,
        email: nextInLine.email,
        isPaused: false,
        remainingTime: 900, // 15 minutos en segundos
        lastUpdated: new Date().toISOString(),
        pausesUsed: 0
      });
    } else {
      // Crear nuevo documento de usuario activo
      await databases.createDocument(DATABASE_ID, COLLECTIONS.ACTIVE_USER, 'active_user_doc', {
        userId: nextInLine.userId,
        email: nextInLine.email,
        isPaused: false,
        remainingTime: 900,
        lastUpdated: new Date().toISOString(),
        pausesUsed: 0
      });
    }
    
    // Remover de la cola
    await databases.deleteDocument(DATABASE_ID, COLLECTIONS.QUEUE, nextInLine.$id);
    
    log(`Usuario ${nextInLine.email} promovido a turno activo.`);
    return res.json({ 
      success: true, 
      userPromoted: nextInLine.email,
      userId: nextInLine.userId 
    });
    
  } catch (e) {
    error('Error en función de promoción:', e);
    return res.json({ success: false, error: e.message }, 500);
  }
};
