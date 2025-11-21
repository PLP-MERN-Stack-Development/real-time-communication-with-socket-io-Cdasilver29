const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');

// Create Express app
const app = express();
app.use(cors());

// Create HTTP server
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "http://localhost:3000",
    methods: ["GET", "POST"]
  },
  // Add reconnection settings
  connectionStateRecovery: {
    maxDisconnectionDuration: 2 * 60 * 1000, // 2 minutes
    skipMiddlewares: true,
  }
});

// Store online users and their rooms
const onlineUsers = new Map(); // socket.id -> {username, room}
const roomUsers = new Map(); // room -> array of usernames
const userSocketMap = new Map(); // username -> socket.id

// When a client connects
io.on('connection', (socket) => {
  console.log('✅ User connected:', socket.id);

  // When user joins with username and room
  socket.on('user_join', (data) => {
    const { username, room } = data;
    
    // Leave previous room if any
    const previousUserData = onlineUsers.get(socket.id);
    if (previousUserData && previousUserData.room) {
      socket.leave(previousUserData.room);
      
      // Remove from room users
      const roomUserList = roomUsers.get(previousUserData.room) || [];
      const updatedRoomUsers = roomUserList.filter(user => user !== previousUserData.username);
      roomUsers.set(previousUserData.room, updatedRoomUsers);
      
      // Notify room about user leaving
      socket.to(previousUserData.room).emit('user_left', previousUserData.username);
      io.to(previousUserData.room).emit('room_users', roomUsers.get(previousUserData.room) || []);
    }

    // Join new room
    onlineUsers.set(socket.id, { username, room });
    userSocketMap.set(username, socket.id);
    socket.join(room);
    
    // Add to room users
    if (!roomUsers.has(room)) {
      roomUsers.set(room, []);
    }
    if (!roomUsers.get(room).includes(username)) {
      roomUsers.get(room).push(username);
    }
    
    console.log(`👋 User ${username} joined room: ${room}`);
    
    // Notify room about new user
    socket.to(room).emit('user_joined', { username, room });
    
    // Send room users list to everyone in the room
    io.to(room).emit('room_users', roomUsers.get(room));
    
    // Send available rooms to everyone
    io.emit('available_rooms', Array.from(roomUsers.keys()));
    
    // Send online users list for private messaging
    io.emit('all_online_users', Array.from(userSocketMap.keys()));
    
    // Send connection success
    socket.emit('connection_success', {
      message: `Successfully joined ${room} room`,
      username,
      room
    });
  });

  // When user sends a message to room
  socket.on('send_message', (data) => {
    const userData = onlineUsers.get(socket.id);
    if (!userData) return;
    
    console.log(`💬 Message from ${userData.username} in ${userData.room}:`, data.message);
    
    // Send message only to users in the same room
    io.to(userData.room).emit('receive_message', {
      username: userData.username,
      message: data.message,
      timestamp: new Date().toLocaleTimeString(),
      room: userData.room,
      type: 'room'
    });
    
    // Send delivery acknowledgment to sender
    socket.emit('message_delivered', {
      messageId: data.messageId,
      timestamp: new Date().toLocaleTimeString()
    });
  });

  // When user sends a private message
  socket.on('send_private_message', (data) => {
    const fromUserData = onlineUsers.get(socket.id);
    if (!fromUserData) return;

    const { toUsername, message, messageId } = data;
    const toSocketId = userSocketMap.get(toUsername);
    
    if (toSocketId) {
      // Send to recipient
      io.to(toSocketId).emit('receive_private_message', {
        from: fromUserData.username,
        message: message,
        timestamp: new Date().toLocaleTimeString(),
        type: 'private'
      });
      
      // Send confirmation to sender
      socket.emit('private_message_delivered', {
        messageId: messageId,
        to: toUsername,
        timestamp: new Date().toLocaleTimeString()
      });
      
      console.log(`🔒 Private message from ${fromUserData.username} to ${toUsername}:`, message);
    } else {
      // Notify sender that user is not online
      socket.emit('private_message_error', {
        error: `${toUsername} is not online`,
        messageId: messageId
      });
    }
  });

  // Handle typing indicators
  socket.on('typing_start', (data) => {
    const userData = onlineUsers.get(socket.id);
    if (userData) {
      if (data.type === 'room') {
        socket.to(userData.room).emit('user_typing', userData.username);
      } else if (data.type === 'private' && data.toUsername) {
        const toSocketId = userSocketMap.get(data.toUsername);
        if (toSocketId) {
          io.to(toSocketId).emit('private_typing', userData.username);
        }
      }
    }
  });

  socket.on('typing_stop', (data) => {
    const userData = onlineUsers.get(socket.id);
    if (userData) {
      if (data.type === 'room') {
        socket.to(userData.room).emit('user_stopped_typing');
      } else if (data.type === 'private' && data.toUsername) {
        const toSocketId = userSocketMap.get(data.toUsername);
        if (toSocketId) {
          io.to(toSocketId).emit('private_typing_stop');
        }
      }
    }
  });

  // Get available rooms
  socket.on('get_rooms', () => {
    socket.emit('available_rooms', Array.from(roomUsers.keys()));
  });

  // Get all online users for private messaging
  socket.on('get_online_users', () => {
    socket.emit('all_online_users', Array.from(userSocketMap.keys()));
  });

  // Handle message reactions
  socket.on('message_reaction', (data) => {
    const userData = onlineUsers.get(socket.id);
    if (userData) {
      // Broadcast reaction to all users in room
      io.to(userData.room).emit('message_reacted', {
        messageId: data.messageId,
        reaction: data.reaction,
        username: userData.username,
        timestamp: new Date().toLocaleTimeString()
      });
    }
  });

  // Handle connection health check
  socket.on('ping', () => {
    socket.emit('pong', { timestamp: Date.now() });
  });

  // When user disconnects
  socket.on('disconnect', (reason) => {
    const userData = onlineUsers.get(socket.id);
    if (userData) {
      const { username, room } = userData;
      
      // Remove from online users
      onlineUsers.delete(socket.id);
      userSocketMap.delete(username);
      
      // Remove from room users
      const roomUserList = roomUsers.get(room) || [];
      const updatedRoomUsers = roomUserList.filter(user => user !== username);
      roomUsers.set(room, updatedRoomUsers);
      
      console.log(`👋 User ${username} disconnected from room: ${room} (Reason: ${reason})`);
      
      // Notify room about user leaving
      socket.to(room).emit('user_left', username);
      io.to(room).emit('room_users', roomUsers.get(room) || []);
      
      // Remove room if empty and update available rooms
      if (updatedRoomUsers.length === 0) {
        roomUsers.delete(room);
      }
      
      // Update online users and available rooms
      io.emit('available_rooms', Array.from(roomUsers.keys()));
      io.emit('all_online_users', Array.from(userSocketMap.keys()));
    }
  });
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    onlineUsers: onlineUsers.size,
    activeRooms: roomUsers.size,
    timestamp: new Date().toISOString()
  });
});

// Start server
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📍 http://localhost:${PORT}`);
  console.log(`❤️  Health check: http://localhost:${PORT}/health`);
});
