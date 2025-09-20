"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.dataStore = void 0;
// src/storage/DataStore.ts
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
class DataStore {
    constructor() {
        // Almacenamiento en memoria
        this.users = new Map();
        this.messages = [];
        this.rooms = new Map();
        this.dataDir = path_1.default.join(process.cwd(), 'data');
        this.usersFile = path_1.default.join(this.dataDir, 'users.json');
        this.messagesFile = path_1.default.join(this.dataDir, 'messages.json');
        this.roomsFile = path_1.default.join(this.dataDir, 'rooms.json');
        this.ensureDataDirectory();
        this.loadData();
    }
    ensureDataDirectory() {
        if (!fs_1.default.existsSync(this.dataDir)) {
            fs_1.default.mkdirSync(this.dataDir, { recursive: true });
        }
    }
    loadData() {
        try {
            // Cargar usuarios
            if (fs_1.default.existsSync(this.usersFile)) {
                const usersData = JSON.parse(fs_1.default.readFileSync(this.usersFile, 'utf8'));
                usersData.forEach((user) => {
                    this.users.set(user.id, {
                        ...user,
                        createdAt: new Date(user.createdAt),
                        lastSeen: new Date(user.lastSeen),
                        isOnline: false // Resetear estado online al iniciar
                    });
                });
            }
            // Cargar mensajes
            if (fs_1.default.existsSync(this.messagesFile)) {
                const messagesData = JSON.parse(fs_1.default.readFileSync(this.messagesFile, 'utf8'));
                this.messages = messagesData.map((msg) => ({
                    ...msg,
                    createdAt: new Date(msg.createdAt)
                }));
            }
            // Cargar salas
            if (fs_1.default.existsSync(this.roomsFile)) {
                const roomsData = JSON.parse(fs_1.default.readFileSync(this.roomsFile, 'utf8'));
                roomsData.forEach((room) => {
                    this.rooms.set(room.id, {
                        ...room,
                        createdAt: new Date(room.createdAt)
                    });
                });
            }
            console.log(`📊 Datos cargados: ${this.users.size} usuarios, ${this.messages.length} mensajes`);
        }
        catch (error) {
            console.error('Error cargando datos:', error);
        }
    }
    saveData() {
        try {
            // Guardar usuarios
            const usersArray = Array.from(this.users.values());
            fs_1.default.writeFileSync(this.usersFile, JSON.stringify(usersArray, null, 2));
            // Guardar mensajes (solo los últimos 1000)
            const recentMessages = this.messages.slice(-1000);
            fs_1.default.writeFileSync(this.messagesFile, JSON.stringify(recentMessages, null, 2));
            // Guardar salas
            const roomsArray = Array.from(this.rooms.values());
            fs_1.default.writeFileSync(this.roomsFile, JSON.stringify(roomsArray, null, 2));
        }
        catch (error) {
            console.error('Error guardando datos:', error);
        }
    }
    // Métodos para usuarios
    findUserByUsername(username) {
        return Array.from(this.users.values()).find(user => user.username === username);
    }
    findUserById(id) {
        return this.users.get(id);
    }
    createUser(userData) {
        const user = {
            id: require('uuid').v4(),
            username: userData.username,
            avatar: userData.avatar,
            isOnline: true,
            lastSeen: new Date(),
            createdAt: new Date() // ← Ahora createdAt está en la interfaz User
        };
        this.users.set(user.id, user);
        this.saveData();
        return user;
    }
    updateUser(id, updates) {
        const user = this.users.get(id);
        if (!user)
            return null;
        const updatedUser = { ...user, ...updates };
        this.users.set(id, updatedUser);
        this.saveData();
        return updatedUser;
    }
    // Métodos para mensajes
    getRecentMessages(limit = 50) {
        return this.messages.slice(-limit);
    }
    createMessage(messageData) {
        const user = this.users.get(messageData.userId);
        if (!user)
            return null;
        const message = {
            id: require('uuid').v4(),
            content: messageData.content,
            type: messageData.type,
            userId: messageData.userId,
            user: user,
            fileUrl: messageData.fileUrl,
            fileName: messageData.fileName,
            fileSize: messageData.fileSize,
            fileMimeType: messageData.fileMimeType,
            createdAt: new Date()
        };
        this.messages.push(message);
        // Mantener solo los últimos 1000 mensajes en memoria
        if (this.messages.length > 1000) {
            this.messages = this.messages.slice(-1000);
        }
        this.saveData();
        return message;
    }
    // Métodos para salas
    createRoom(roomData) {
        const room = {
            id: require('uuid').v4(),
            name: roomData.name,
            description: roomData.description,
            isPrivate: roomData.isPrivate || false,
            createdAt: new Date() // ← Ahora createdAt está en la interfaz Room
        };
        this.rooms.set(room.id, room);
        this.saveData();
        return room;
    }
    getAllRooms() {
        return Array.from(this.rooms.values());
    }
    // Método para limpiar datos antiguos (opcional)
    cleanup() {
        const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        // Limpiar mensajes antiguos
        this.messages = this.messages.filter(msg => msg.createdAt > oneWeekAgo);
        // Limpiar usuarios inactivos (opcional)
        // this.users.forEach((user, id) => {
        //   if (!user.isOnline && user.lastSeen < oneWeekAgo) {
        //     this.users.delete(id);
        //   }
        // });
        this.saveData();
    }
}
exports.dataStore = new DataStore();
//# sourceMappingURL=DataStore.js.map