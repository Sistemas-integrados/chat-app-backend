import { User, Message, Room } from '../types';
declare class DataStore {
    private dataDir;
    private usersFile;
    private messagesFile;
    private roomsFile;
    private users;
    private messages;
    private rooms;
    constructor();
    private ensureDataDirectory;
    private loadData;
    private saveData;
    findUserByUsername(username: string): User | undefined;
    findUserById(id: string): User | undefined;
    createUser(userData: {
        username: string;
        avatar: string;
    }): User;
    updateUser(id: string, updates: Partial<User>): User | null;
    getRecentMessages(limit?: number): Message[];
    createMessage(messageData: {
        content: string;
        type: 'text' | 'file' | 'image';
        userId: string;
        fileUrl?: string;
        fileName?: string;
        fileSize?: number;
        fileMimeType?: string;
    }): Message | null;
    createRoom(roomData: {
        name: string;
        description?: string;
        isPrivate?: boolean;
    }): Room;
    getAllRooms(): Room[];
    cleanup(): void;
}
export declare const dataStore: DataStore;
export {};
//# sourceMappingURL=DataStore.d.ts.map