// src/server.ts
import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import mime from 'mime-types';

import { User, Message, FileInfo, SocketUser } from './types';
import { dataStore } from './storage/DataStore';

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Middleware
app.use(cors({
  origin: "*"
}));
app.use(express.json());
app.use('/uploads', express.static('uploads'));

// Configuración de multer
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = 'uploads/';
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const extension = path.extname(file.originalname);
    cb(null, `${uniqueSuffix}${extension}`);
  }
});

const upload = multer({ 
  storage: storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
  fileFilter: (req, file, cb) => {
    cb(null, true);
  }
});

// Almacenamiento en memoria para usuarios conectados
const connectedUsers = new Map<string, SocketUser>();

// Rutas API
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage()
  });
});

app.post('/api/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No se subió ningún archivo' });
    }
    
    const fileInfo: FileInfo = {
      filename: req.file.filename,
      originalname: req.file.originalname,
      size: req.file.size,
      mimetype: req.file.mimetype,
      url: `/uploads/${req.file.filename}`
    };
    
    res.json(fileInfo);
  } catch (error) {
    console.error('Error uploading file:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

app.get('/api/messages', (req, res) => {
  try {
    const messages = dataStore.getRecentMessages(100);
    res.json(messages);
  } catch (error) {
    console.error('Error fetching messages:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

app.get('/api/users/online', (req, res) => {
  const onlineUsers = Array.from(connectedUsers.values()).map(user => ({
    id: user.id,
    username: user.username,
    avatar: user.avatar,
    isOnline: true
  }));
  
  res.json(onlineUsers);
});

app.get('/api/stats', (req, res) => {
  const stats = {
    onlineUsers: connectedUsers.size,
    totalMessages: dataStore.getRecentMessages(1000).length,
    uptime: process.uptime(),
    memoryUsage: process.memoryUsage()
  };
  
  res.json(stats);
});

// Socket.IO eventos
io.on('connection', (socket) => {
  console.log('Usuario conectado:', socket.id);

  socket.on('join', async (userData: { username: string; avatar: string }) => {
    try {
      // Buscar usuario existente
      let user = dataStore.findUserByUsername(userData.username);

      if (!user) {
        // Crear nuevo usuario
        user = dataStore.createUser({
          username: userData.username,
          avatar: userData.avatar
        });
      } else {
        // Actualizar usuario existente
        user = dataStore.updateUser(user.id, {
          isOnline: true,
          avatar: userData.avatar,
          lastSeen: new Date()
        })!;
      }

      // Agregar a usuarios conectados
      const socketUser: SocketUser = {
        ...user,
        socketId: socket.id
      };
      connectedUsers.set(socket.id, socketUser);

      // Unirse a sala general
      socket.join('general');

      // 1. PRIMERO: Enviar datos iniciales al usuario que se conecta
      const recentMessages = dataStore.getRecentMessages(50);
      const currentOnlineUsers = Array.from(connectedUsers.values());
      
      // Enviar mensajes recientes al nuevo usuario
      socket.emit('recentMessages', recentMessages);
      
      // Enviar lista completa de usuarios online al nuevo usuario
      socket.emit('onlineUsers', currentOnlineUsers);
      
      // Confirmar conexión exitosa al nuevo usuario
      const joinSuccessData = {
        user: socketUser,
        onlineUsers: currentOnlineUsers,
        recentMessages: recentMessages
      };
      socket.emit('joinSuccess', joinSuccessData);

      // 2. SEGUNDO: Notificar a OTROS usuarios (no al que se acaba de conectar)
      socket.to('general').emit('userJoined', {
        user: socketUser,
        onlineUsers: currentOnlineUsers
      });

      console.log(`✅ Usuario ${user.username} se unió al chat`);

    } catch (error) {
      console.error('Error joining chat:', error);
      socket.emit('error', { message: 'Error al unirse al chat' });
    }
  });

  socket.on('sendMessage', async (messageData: any) => {
    // 🔄 NORMALIZAR DATOS: Manejar diferentes formatos del frontend
    let normalizedData: {
      content: string;
      type: 'text' | 'file' | 'image';
      file?: FileInfo;
    };
    
    if (messageData.text) {
      // Formato del frontend actual: { text, user, timestamp, id }
      normalizedData = {
        content: String(messageData.text || ''), // Convertir a string y manejar undefined
        type: messageData.type || 'text',
        file: messageData.file
      };
    } else if (messageData.content) {
      // Formato esperado: { content, type, file }
      normalizedData = {
        content: String(messageData.content || ''), // Convertir a string y manejar undefined
        type: messageData.type || 'text',
        file: messageData.file
      };
    } else {
      console.log('❌ Sin text ni content:', messageData);
      socket.emit('error', { message: 'Contenido del mensaje es requerido' });
      return;
    }
    
    // Validar datos normalizados
    if (!normalizedData.content || typeof normalizedData.content !== 'string' || normalizedData.content.trim() === '') {
      console.log('❌ Contenido inválido:', { 
        hasContent: !!normalizedData.content, 
        type: typeof normalizedData.content, 
        value: normalizedData.content 
      });
      socket.emit('error', { message: 'Contenido del mensaje no puede estar vacío' });
      return;
    }
    
    try {
      const user = connectedUsers.get(socket.id);
      if (!user) return;

      const message = dataStore.createMessage({
        content: normalizedData.content,
        type: normalizedData.type,
        userId: user.id,
        fileUrl: normalizedData.file?.url,
        fileName: normalizedData.file?.originalname,
        fileSize: normalizedData.file?.size,
        fileMimeType: normalizedData.file?.mimetype
      });

      if (message) {
        io.to('general').emit('newMessage', message);
        // Log de debugging temporal para Render
        console.log('🔍 Debug - normalizedData:', { 
          hasContent: !!normalizedData?.content, 
          contentType: typeof normalizedData?.content,
          contentLength: normalizedData?.content?.length 
        });
        // Protección robusta para el log
        const contentPreview = (normalizedData?.content && typeof normalizedData.content === 'string') 
          ? normalizedData.content.substring(0, 50) 
          : '[CONTENIDO NO VÁLIDO]';
        console.log(`💬 Mensaje de ${user.username}: ${contentPreview}...`);
      }

    } catch (error) {
      console.error('Error sending message:', error);
      socket.emit('error', { message: 'Error al enviar mensaje' });
    }
  });

  socket.on('typing', (data: { isTyping: boolean }) => {
    const user = connectedUsers.get(socket.id);
    if (user) {
      socket.to('general').emit('userTyping', {
        user: user,
        isTyping: data.isTyping
      });
    }
  });

  socket.on('disconnect', async () => {
    try {
      const user = connectedUsers.get(socket.id);
      if (user) {
        // Actualizar estado offline
        dataStore.updateUser(user.id, {
          isOnline: false,
          lastSeen: new Date()
        });

        connectedUsers.delete(socket.id);

        const onlineUsers = Array.from(connectedUsers.values());
        
        io.emit('userLeft', {
          user: user,
          onlineUsers: onlineUsers
        });

        console.log(`❌ Usuario ${user.username} se desconectó`);
      }
    } catch (error) {
      console.error('Error handling disconnect:', error);
    }
  });
});

// Limpiar datos antiguos cada hora
setInterval(() => {
  dataStore.cleanup();
}, 60 * 60 * 1000);

// Manejo de cierre graceful
process.on('SIGINT', () => {
  console.log('\n🛑 Cerrando servidor...');
  server.close(() => {
    console.log('✅ Servidor cerrado correctamente');
    process.exit(0);
  });
});

process.on('SIGTERM', () => {
  console.log('\n🛑 Cerrando servidor...');
  server.close(() => {
    console.log('✅ Servidor cerrado correctamente');
    process.exit(0);
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`🚀 Servidor corriendo en puerto ${PORT}`);
  console.log(`📁 Datos almacenados en: ${path.join(process.cwd(), 'data')}`);
});