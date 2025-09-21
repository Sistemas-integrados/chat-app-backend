// src/storage/DataStore.ts
import fs from 'fs';
import path from 'path';
import { User, Message, Room } from '../types'; // ← Ahora Room está exportado

class DataStore {
  private dataDir: string;
  private usersFile: string;
  private messagesFile: string;
  private roomsFile: string;

  // Almacenamiento en memoria
  private users: Map<string, User> = new Map();
  private messages: Message[] = [];
  private rooms: Map<string, Room> = new Map();

  constructor() {
    this.dataDir = path.join(process.cwd(), 'data');
    this.usersFile = path.join(this.dataDir, 'users.json');
    this.messagesFile = path.join(this.dataDir, 'messages.json');
    this.roomsFile = path.join(this.dataDir, 'rooms.json');

    this.ensureDataDirectory();
    this.loadData();
  }

  private ensureDataDirectory() {
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }
  }

  private loadData() {
    try {
      // Cargar usuarios
      if (fs.existsSync(this.usersFile)) {
        const usersData = JSON.parse(fs.readFileSync(this.usersFile, 'utf8'));
        usersData.forEach((user: any) => { // ← Cambiar a 'any' para evitar conflictos
          this.users.set(user.id, {
            ...user,
            createdAt: new Date(user.createdAt),
            lastSeen: new Date(user.lastSeen),
            isOnline: false // Resetear estado online al iniciar
          });
        });
      }

      // Cargar mensajes
      if (fs.existsSync(this.messagesFile)) {
        const messagesData = JSON.parse(fs.readFileSync(this.messagesFile, 'utf8'));
        this.messages = messagesData.map((msg: any) => ({
          ...msg,
          createdAt: new Date(msg.createdAt)
        }));
      }

      // Cargar salas
      if (fs.existsSync(this.roomsFile)) {
        const roomsData = JSON.parse(fs.readFileSync(this.roomsFile, 'utf8'));
        roomsData.forEach((room: any) => { // ← Cambiar a 'any'
          this.rooms.set(room.id, {
            ...room,
            createdAt: new Date(room.createdAt)
          });
        });
      }

      console.log(`📊 Datos cargados: ${this.users.size} usuarios, ${this.messages.length} mensajes`);
    } catch (error) {
      console.error('Error cargando datos:', error);
    }
  }

  private saveData() {
    try {
      // Guardar usuarios
      const usersArray = Array.from(this.users.values());
      fs.writeFileSync(this.usersFile, JSON.stringify(usersArray, null, 2));

      // Guardar mensajes (solo los últimos 1000)
      const recentMessages = this.messages.slice(-1000);
      fs.writeFileSync(this.messagesFile, JSON.stringify(recentMessages, null, 2));

      // Guardar salas
      const roomsArray = Array.from(this.rooms.values());
      fs.writeFileSync(this.roomsFile, JSON.stringify(roomsArray, null, 2));
    } catch (error) {
      console.error('Error guardando datos:', error);
    }
  }

  // Métodos para usuarios
  findUserByUsername(username: string): User | undefined {
    return Array.from(this.users.values()).find(user => user.username === username);
  }

  findUserById(id: string): User | undefined {
    return this.users.get(id);
  }

  createUser(userData: { username: string; avatar: string }): User {
    const user: User = {
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

  updateUser(id: string, updates: Partial<User>): User | null {
    const user = this.users.get(id);
    if (!user) return null;

    const updatedUser = { ...user, ...updates };
    this.users.set(id, updatedUser);
    this.saveData();
    return updatedUser;
  }

  // Métodos para mensajes
  getRecentMessages(limit: number = 50): Message[] {
    return this.messages.slice(-limit);
  }

  createMessage(messageData: {
    content: string;
    type: 'text' | 'file' | 'image';
    userId: string;
    fileUrl?: string;
    fileName?: string;
    fileSize?: number;
    fileMimeType?: string;
  }): Message | null {
    // Validar datos requeridos
    if (!messageData.content || typeof messageData.content !== 'string') {
      return null;
    }
    
    if (!messageData.userId) {
      return null;
    }
    
    const user = this.users.get(messageData.userId);
    if (!user) {
      return null;
    }

    const message: Message = {
      id: require('uuid').v4(),
      content: messageData.content.trim(),
      type: messageData.type || 'text',
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
  createRoom(roomData: { name: string; description?: string; isPrivate?: boolean }): Room {
    const room: Room = {
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

  getAllRooms(): Room[] {
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

export const dataStore = new DataStore();