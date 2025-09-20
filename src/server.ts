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
  console.log(`🔌 Nueva conexión WebSocket: ${socket.id}`);

  socket.on('join', async (userData: { username: string; avatar: string }) => {
    console.log(`📥 Evento 'join' recibido de ${socket.id}:`, userData);
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
      
      // 🔍 DEBUG: Mostrar información detallada
      console.log('\n=== DEBUG: INFORMACIÓN AL CONECTARSE ===');
      console.log(`👤 Usuario conectándose: ${user.username} (${socket.id})`);
      console.log(`📊 Total usuarios conectados: ${currentOnlineUsers.length}`);
      console.log('👥 Lista de usuarios online:');
      currentOnlineUsers.forEach((u, index) => {
        console.log(`  ${index + 1}. ${u.username} (${u.socketId}) - Online: ${u.isOnline}`);
      });
      console.log(`📨 Mensajes recientes encontrados: ${recentMessages.length}`);
      console.log('==========================================\n');
      
      // Enviar mensajes recientes al nuevo usuario
      console.log(`📤 Enviando 'recentMessages' a ${user.username}: ${recentMessages.length} mensajes`);
      socket.emit('recentMessages', recentMessages);
      
      // Enviar lista completa de usuarios online al nuevo usuario
      console.log(`📤 Enviando 'onlineUsers' a ${user.username}: ${currentOnlineUsers.length} usuarios`);
      socket.emit('onlineUsers', currentOnlineUsers);
      
      // Confirmar conexión exitosa al nuevo usuario
      const joinSuccessData = {
        user: socketUser,
        onlineUsers: currentOnlineUsers,
        recentMessages: recentMessages
      };
      console.log(`📤 Enviando 'joinSuccess' a ${user.username}:`, {
        user: socketUser.username,
        onlineUsersCount: currentOnlineUsers.length,
        recentMessagesCount: recentMessages.length
      });
      socket.emit('joinSuccess', joinSuccessData);

      // 2. SEGUNDO: Notificar a OTROS usuarios (no al que se acaba de conectar)
      console.log(`📢 Notificando 'userJoined' a otros usuarios en sala 'general'`);
      socket.to('general').emit('userJoined', {
        user: socketUser,
        onlineUsers: currentOnlineUsers
      });

      console.log(`✅ Usuario ${user.username} se unió al chat exitosamente`);

    } catch (error) {
      console.error('Error joining chat:', error);
      socket.emit('error', { message: 'Error al unirse al chat' });
    }
  });

  socket.on('sendMessage', async (messageData: {
    content: string;
    type: 'text' | 'file' | 'image';
    file?: FileInfo;
  }) => {
    try {
      const user = connectedUsers.get(socket.id);
      if (!user) return;

      const message = dataStore.createMessage({
        content: messageData.content,
        type: messageData.type,
        userId: user.id,
        fileUrl: messageData.file?.url,
        fileName: messageData.file?.originalname,
        fileSize: messageData.file?.size,
        fileMimeType: messageData.file?.mimetype
      });

      if (message) {
        io.to('general').emit('newMessage', message);
        console.log(`💬 Mensaje de ${user.username}: ${messageData.content.substring(0, 50)}...`);
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
    console.log(`🔌❌ Desconexión de socket: ${socket.id}`);
    try {
      const user = connectedUsers.get(socket.id);
      if (user) {
        console.log(`👤❌ Usuario desconectándose: ${user.username}`);
        
        // Actualizar estado offline
        dataStore.updateUser(user.id, {
          isOnline: false,
          lastSeen: new Date()
        });

        connectedUsers.delete(socket.id);

        const onlineUsers = Array.from(connectedUsers.values());
        console.log(`📊 Usuarios restantes online: ${onlineUsers.length}`);
        
        io.emit('userLeft', {
          user: user,
          onlineUsers: onlineUsers
        });

        console.log(`❌ Usuario ${user.username} se desconectó`);
      } else {
        console.log(`⚠️ Socket ${socket.id} se desconectó pero no tenía usuario asociado`);
      }
    } catch (error) {
      console.error('Error handling disconnect:', error);
    }
  });
});

// Limpiar datos antiguos cada hora
setInterval(() => {
  dataStore.cleanup();
  console.log('🧹 Limpieza de datos completada');
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