"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// src/server.ts
const express_1 = __importDefault(require("express"));
const http_1 = __importDefault(require("http"));
const socket_io_1 = require("socket.io");
const cors_1 = __importDefault(require("cors"));
const multer_1 = __importDefault(require("multer"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const DataStore_1 = require("./storage/DataStore");
const app = (0, express_1.default)();
const server = http_1.default.createServer(app);
const io = new socket_io_1.Server(server, {
    cors: {
        origin: process.env.FRONTEND_URL || "http://localhost:3000",
        methods: ["GET", "POST"]
    }
});
// Middleware
app.use((0, cors_1.default)({
    origin: process.env.FRONTEND_URL || "http://localhost:3000"
}));
app.use(express_1.default.json());
app.use('/uploads', express_1.default.static('uploads'));
// Configuración de multer
const storage = multer_1.default.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = 'uploads/';
        if (!fs_1.default.existsSync(uploadDir)) {
            fs_1.default.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const extension = path_1.default.extname(file.originalname);
        cb(null, `${uniqueSuffix}${extension}`);
    }
});
const upload = (0, multer_1.default)({
    storage: storage,
    limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
    fileFilter: (req, file, cb) => {
        cb(null, true);
    }
});
// Almacenamiento en memoria para usuarios conectados
const connectedUsers = new Map();
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
        const fileInfo = {
            filename: req.file.filename,
            originalname: req.file.originalname,
            size: req.file.size,
            mimetype: req.file.mimetype,
            url: `/uploads/${req.file.filename}`
        };
        res.json(fileInfo);
    }
    catch (error) {
        console.error('Error uploading file:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});
app.get('/api/messages', (req, res) => {
    try {
        const messages = DataStore_1.dataStore.getRecentMessages(100);
        res.json(messages);
    }
    catch (error) {
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
        totalMessages: DataStore_1.dataStore.getRecentMessages(1000).length,
        uptime: process.uptime(),
        memoryUsage: process.memoryUsage()
    };
    res.json(stats);
});
// Socket.IO eventos
io.on('connection', (socket) => {
    console.log(`🔌 Nueva conexión WebSocket: ${socket.id}`);
    socket.on('join', async (userData) => {
        console.log(`📥 Evento 'join' recibido de ${socket.id}:`, userData);
        try {
            // Buscar usuario existente
            let user = DataStore_1.dataStore.findUserByUsername(userData.username);
            if (!user) {
                // Crear nuevo usuario
                user = DataStore_1.dataStore.createUser({
                    username: userData.username,
                    avatar: userData.avatar
                });
            }
            else {
                // Actualizar usuario existente
                user = DataStore_1.dataStore.updateUser(user.id, {
                    isOnline: true,
                    avatar: userData.avatar,
                    lastSeen: new Date()
                });
            }
            // Agregar a usuarios conectados
            const socketUser = {
                ...user,
                socketId: socket.id
            };
            connectedUsers.set(socket.id, socketUser);
            // Unirse a sala general
            socket.join('general');
            // 1. PRIMERO: Enviar datos iniciales al usuario que se conecta
            const recentMessages = DataStore_1.dataStore.getRecentMessages(50);
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
        }
        catch (error) {
            console.error('Error joining chat:', error);
            socket.emit('error', { message: 'Error al unirse al chat' });
        }
    });
    socket.on('sendMessage', async (messageData) => {
        try {
            const user = connectedUsers.get(socket.id);
            if (!user)
                return;
            const message = DataStore_1.dataStore.createMessage({
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
        }
        catch (error) {
            console.error('Error sending message:', error);
            socket.emit('error', { message: 'Error al enviar mensaje' });
        }
    });
    socket.on('typing', (data) => {
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
                DataStore_1.dataStore.updateUser(user.id, {
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
            }
            else {
                console.log(`⚠️ Socket ${socket.id} se desconectó pero no tenía usuario asociado`);
            }
        }
        catch (error) {
            console.error('Error handling disconnect:', error);
        }
    });
});
// Limpiar datos antiguos cada hora
setInterval(() => {
    DataStore_1.dataStore.cleanup();
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
    console.log(`📁 Datos almacenados en: ${path_1.default.join(process.cwd(), 'data')}`);
});
//# sourceMappingURL=server.js.map