import React, { useState, useEffect, useRef } from 'react';
import io from 'socket.io-client';
import './App.css';

// Connect to our server
const socket = io('http://localhost:5000', {
  reconnection: true,
  reconnectionAttempts: 5,
  reconnectionDelay: 1000,
});

// Define types for our data
interface Message {
  id?: string;
  username: string;
  message: string;
  timestamp: string;
  room: string;
  type?: string;
  isSystem?: boolean;
  from?: string;
  to?: string;
  reaction?: string;
}

interface UserData {
  username: string;
  room: string;
}

function App() {
  const [username, setUsername] = useState<string>('');
  const [room, setRoom] = useState<string>('general');
  const [message, setMessage] = useState<string>('');
  const [privateMessage, setPrivateMessage] = useState<string>('');
  const [selectedUser, setSelectedUser] = useState<string>('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [onlineUsers, setOnlineUsers] = useState<string[]>([]);
  const [allOnlineUsers, setAllOnlineUsers] = useState<string[]>([]);
  const [availableRooms, setAvailableRooms] = useState<string[]>(['general']);
  const [isLoggedIn, setIsLoggedIn] = useState<boolean>(false);
  const [isTyping, setIsTyping] = useState<string>('');
  const [privateTyping, setPrivateTyping] = useState<string>('');
  const [typingTimeout, setTypingTimeout] = useState<NodeJS.Timeout | null>(null);
  const [privateTypingTimeout, setPrivateTypingTimeout] = useState<NodeJS.Timeout | null>(null);
  const [activeTab, setActiveTab] = useState<'room' | 'private'>('room');
  const [isConnected, setIsConnected] = useState<boolean>(socket.connected);
  const [reconnectAttempts, setReconnectAttempts] = useState<number>(0);
  const [unreadCounts, setUnreadCounts] = useState<{[key: string]: number}>({});
  const [messageIdCounter, setMessageIdCounter] = useState<number>(1);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Scroll to bottom when new messages arrive
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Handle unread counts when tab is not active
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        // Reset unread count for current view when tab becomes active
        if (activeTab === 'room') {
          setUnreadCounts(prev => ({...prev, [room]: 0}));
        } else if (activeTab === 'private' && selectedUser) {
          setUnreadCounts(prev => ({...prev, [`private_${selectedUser}`]: 0}));
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [activeTab, room, selectedUser]);

  // Listen for incoming messages and events
  useEffect(() => {
    // Connection status events
    socket.on('connect', () => {
      setIsConnected(true);
      setReconnectAttempts(0);
      console.log('✅ Connected to server');
      
      // Re-join room after reconnection
      if (username && room && isLoggedIn) {
        socket.emit('user_join', { username, room });
      }
    });

    socket.on('disconnect', () => {
      setIsConnected(false);
      console.log('❌ Disconnected from server');
    });

    socket.on('reconnect', (attempt) => {
      setIsConnected(true);
      setReconnectAttempts(attempt);
      console.log(`✅ Reconnected after ${attempt} attempts`);
    });

    socket.on('reconnect_attempt', (attempt) => {
      setReconnectAttempts(attempt);
      console.log(`🔄 Reconnection attempt ${attempt}`);
    });

    socket.on('reconnect_failed', () => {
      console.log('❌ Reconnection failed');
      setMessages(prev => [...prev, {
        username: 'System',
        message: 'Failed to reconnect to server. Please refresh the page.',
        timestamp: new Date().toLocaleTimeString(),
        room: 'system',
        type: 'system',
        isSystem: true
      }]);
    });

    // When receiving a room message
    socket.on('receive_message', (data: Message) => {
      setMessages(prev => [...prev, { ...data, type: 'room' }]);
      
      // Increment unread count if tab is not active or different room
      if (document.hidden || activeTab !== 'room') {
        setUnreadCounts(prev => ({
          ...prev, 
          [data.room]: (prev[data.room] || 0) + 1
        }));
      }
      
      playNotificationSound();
    });

    // When receiving a private message
    socket.on('receive_private_message', (data: any) => {
      setMessages(prev => [...prev, { ...data, type: 'private' }]);
      
      // Increment unread count for private messages
      if (document.hidden || activeTab !== 'private' || data.from !== selectedUser) {
        setUnreadCounts(prev => ({
          ...prev, 
          [`private_${data.from}`]: (prev[`private_${data.from}`] || 0) + 1
        }));
      }
      
      playNotificationSound();
    });

    // Message delivery confirmations
    socket.on('message_delivered', (data: any) => {
      console.log('✅ Message delivered:', data.messageId);
    });

    socket.on('private_message_delivered', (data: any) => {
      console.log('✅ Private message delivered to:', data.to);
    });

    // When private message fails
    socket.on('private_message_error', (data: { error: string, messageId: string }) => {
      setMessages(prev => [...prev, {
        username: 'System',
        message: data.error,
        timestamp: new Date().toLocaleTimeString(),
        room: 'system',
        type: 'system',
        isSystem: true
      }]);
    });

    // Connection success
    socket.on('connection_success', (data: any) => {
      setMessages(prev => [...prev, {
        username: 'System',
        message: data.message,
        timestamp: new Date().toLocaleTimeString(),
        room: data.room,
        type: 'system',
        isSystem: true
      }]);
    });

    // When a user joins
    socket.on('user_joined', (data: { username: string; room: string }) => {
      setMessages(prev => [...prev, {
        username: 'System',
        message: `${data.username} joined the room`,
        timestamp: new Date().toLocaleTimeString(),
        room: data.room,
        type: 'system',
        isSystem: true
      }]);
    });

    // When a user leaves
    socket.on('user_left', (user: string) => {
      setMessages(prev => [...prev, {
        username: 'System',
        message: `${user} left the room`,
        timestamp: new Date().toLocaleTimeString(),
        room: room,
        type: 'system',
        isSystem: true
      }]);
    });

    // Update room users list
    socket.on('room_users', (users: string[]) => {
      setOnlineUsers(users);
    });

    // Update all online users for private messaging
    socket.on('all_online_users', (users: string[]) => {
      setAllOnlineUsers(users.filter(user => user !== username));
    });

    // Update available rooms
    socket.on('available_rooms', (rooms: string[]) => {
      setAvailableRooms(rooms.length > 0 ? rooms : ['general']);
    });

    // When someone is typing in room
    socket.on('user_typing', (user: string) => {
      setIsTyping(`${user} is typing...`);
    });

    // When someone stops typing in room
    socket.on('user_stopped_typing', () => {
      setIsTyping('');
    });

    // When someone is typing in private chat
    socket.on('private_typing', (user: string) => {
      setPrivateTyping(`${user} is typing...`);
    });

    // When someone stops typing in private chat
    socket.on('private_typing_stop', () => {
      setPrivateTyping('');
    });

    // Message reactions
    socket.on('message_reacted', (data: any) => {
      console.log('Reaction received:', data);
      // You can implement reaction display here
    });

    // Get initial rooms and users
    socket.emit('get_rooms');
    socket.emit('get_online_users');

    // Clean up on component unmount
    return () => {
      socket.off('connect');
      socket.off('disconnect');
      socket.off('reconnect');
      socket.off('reconnect_attempt');
      socket.off('reconnect_failed');
      socket.off('receive_message');
      socket.off('receive_private_message');
      socket.off('message_delivered');
      socket.off('private_message_delivered');
      socket.off('private_message_error');
      socket.off('connection_success');
      socket.off('user_joined');
      socket.off('user_left');
      socket.off('room_users');
      socket.off('all_online_users');
      socket.off('available_rooms');
      socket.off('user_typing');
      socket.off('user_stopped_typing');
      socket.off('private_typing');
      socket.off('private_typing_stop');
      socket.off('message_reacted');
    };
  }, [room, username, isLoggedIn, activeTab, selectedUser]);

  // Play notification sound
  const playNotificationSound = () => {
    // Create a simple beep sound using Web Audio API
    try {
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();
      
      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);
      
      oscillator.frequency.value = 800;
      oscillator.type = 'sine';
      
      gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.2);
      
      oscillator.start(audioContext.currentTime);
      oscillator.stop(audioContext.currentTime + 0.2);
    } catch (error) {
      console.log('Sound notification not supported');
    }
  };

  // Handle login
  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (username.trim() && room.trim()) {
      socket.emit('user_join', { username, room });
      setIsLoggedIn(true);
    }
  };

  // Handle room change
  const handleRoomChange = (newRoom: string) => {
    if (newRoom !== room) {
      // Clear current messages when changing rooms
      setMessages([]);
      setRoom(newRoom);
      setActiveTab('room');
      
      // Join new room
      socket.emit('user_join', { username, room: newRoom });
    }
  };

  // Handle sending room messages
  const sendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (message.trim()) {
      const messageId = `msg_${messageIdCounter}`;
      socket.emit('send_message', { 
        message, 
        messageId 
      });
      setMessage('');
      setMessageIdCounter(prev => prev + 1);
      
      // Stop typing indicator when message is sent
      socket.emit('typing_stop', { type: 'room' });
      if (typingTimeout) {
        clearTimeout(typingTimeout);
        setTypingTimeout(null);
      }
    }
  };

  // Handle sending private messages
  const sendPrivateMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (privateMessage.trim() && selectedUser) {
      const messageId = `private_${messageIdCounter}`;
      socket.emit('send_private_message', { 
        toUsername: selectedUser, 
        message: privateMessage,
        messageId
      });
      setPrivateMessage('');
      setMessageIdCounter(prev => prev + 1);
      
      // Stop typing indicator when message is sent
      socket.emit('typing_stop', { 
        type: 'private', 
        toUsername: selectedUser 
      });
      if (privateTypingTimeout) {
        clearTimeout(privateTypingTimeout);
        setPrivateTypingTimeout(null);
      }
    }
  };

  // Handle typing events for room messages
  const handleTyping = () => {
    if (message.trim() && activeTab === 'room') {
      socket.emit('typing_start', { type: 'room' });
    } else {
      socket.emit('typing_stop', { type: 'room' });
      return;
    }
    
    // Clear existing timeout
    if (typingTimeout) clearTimeout(typingTimeout);
    
    // Set new timeout to stop typing indicator
    const timeout = setTimeout(() => {
      socket.emit('typing_stop', { type: 'room' });
    }, 1000);
    
    setTypingTimeout(timeout);
  };

  // Handle typing events for private messages
  const handlePrivateTyping = () => {
    if (privateMessage.trim() && activeTab === 'private' && selectedUser) {
      socket.emit('typing_start', { 
        type: 'private', 
        toUsername: selectedUser 
      });
    } else {
      if (selectedUser) {
        socket.emit('typing_stop', { 
          type: 'private', 
          toUsername: selectedUser 
        });
      }
      return;
    }
    
    // Clear existing timeout
    if (privateTypingTimeout) clearTimeout(privateTypingTimeout);
    
    // Set new timeout to stop typing indicator
    const timeout = setTimeout(() => {
      if (selectedUser) {
        socket.emit('typing_stop', { 
          type: 'private', 
          toUsername: selectedUser 
        });
      }
    }, 1000);
    
    setPrivateTypingTimeout(timeout);
  };

  // Create new room
  const createNewRoom = () => {
    const newRoom = prompt('Enter new room name:');
    if (newRoom && newRoom.trim()) {
      handleRoomChange(newRoom.trim());
    }
  };

  // Start private chat with user
  const startPrivateChat = (user: string) => {
    setSelectedUser(user);
    setActiveTab('private');
    // Reset unread count when starting private chat
    setUnreadCounts(prev => ({...prev, [`private_${user}`]: 0}));
  };

  // Filter messages for current view
  const getFilteredMessages = () => {
    if (activeTab === 'room') {
      return messages.filter(msg => 
        msg.type === 'room' && msg.room === room
      );
    } else {
      return messages.filter(msg => 
        msg.type === 'private' && 
        ((msg.from === selectedUser) || 
         (msg.from === username && msg.to === selectedUser))
      );
    }
  };

  // Get unread count for display
  const getUnreadCount = (target: string, type: 'room' | 'private' = 'room') => {
    const key = type === 'room' ? target : `private_${target}`;
    return unreadCounts[key] || 0;
  };

  // Login form
  if (!isLoggedIn) {
    return (
      <div className="login-container">
        <div className="login-box">
          <h1>💬 Chat App</h1>
          <form onSubmit={handleLogin}>
            <input
              type="text"
              placeholder="Enter your username..."
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="username-input"
            />
            <select 
              value={room} 
              onChange={(e) => setRoom(e.target.value)}
              className="room-select"
            >
              <option value="general">General</option>
              <option value="random">Random</option>
              <option value="gaming">Gaming</option>
              <option value="programming">Programming</option>
            </select>
            <button type="submit" className="join-btn">
              Join Chat
            </button>
          </form>
        </div>
      </div>
    );
  }

  // Chat interface
  return (
    <div className="chat-container">
      {/* Connection Status Bar */}
      {!isConnected && (
        <div className="reconnection-info">
          🔄 Connecting... {reconnectAttempts > 0 && `(Attempt ${reconnectAttempts})`}
        </div>
      )}

      {/* Header */}
      <div className="chat-header">
        <h1>
          {activeTab === 'room' ? `💬 ${room} Room` : `🔒 Private: ${selectedUser || 'Select User'}`}
          {activeTab === 'room' && getUnreadCount(room) > 0 && (
            <span className="unread-badge">{getUnreadCount(room)}</span>
          )}
        </h1>
        <div className="online-info">
          <div className="connection-status">
            <span className={`status-dot ${isConnected ? 'connected' : 'disconnected'}`}>
              {isConnected ? '🟢' : '🔴'}
            </span>
            <span>{isConnected ? 'Connected' : 'Connecting...'}</span>
          </div>
          <span>Online: {allOnlineUsers.length + 1}</span>
          <div className="user-badge">You: {username}</div>
        </div>
      </div>

      <div className="chat-body">
        {/* Rooms & Users Sidebar */}
        <div className="rooms-sidebar">
          <div className="rooms-header">
            <h3>Chat Rooms</h3>
            <button onClick={createNewRoom} className="new-room-btn">
              + New
            </button>
          </div>
          <div className="rooms-list">
            {availableRooms.map((roomName, index) => (
              <div 
                key={index} 
                className={`room-item ${roomName === room ? 'active-room' : ''}`}
                onClick={() => handleRoomChange(roomName)}
              >
                # {roomName}
                {getUnreadCount(roomName) > 0 && (
                  <span className="unread-badge-small">{getUnreadCount(roomName)}</span>
                )}
              </div>
            ))}
          </div>

          {/* Online Users for Private Messaging */}
          <div className="online-users-section">
            <h3>Private Chat ({allOnlineUsers.length})</h3>
            <div className="users-list">
              {allOnlineUsers.map((user, index) => (
                <div 
                  key={index} 
                  className={`user-item ${user === selectedUser ? 'selected-user' : ''}`}
                  onClick={() => startPrivateChat(user)}
                >
                  <span className="online-dot">🟢</span>
                  {user}
                  {getUnreadCount(user, 'private') > 0 && (
                    <span className="unread-badge-small">{getUnreadCount(user, 'private')}</span>
                  )}
                  {user === selectedUser && <span className="private-badge">💬</span>}
                </div>
              ))}
              {allOnlineUsers.length === 0 && (
                <div className="no-users">No other users online</div>
              )}
            </div>
          </div>

          {/* Current Room Users */}
          <div className="online-users-section">
            <h3>Online in {room} ({onlineUsers.length})</h3>
            <div className="users-list">
              {onlineUsers.map((user, index) => (
                <div key={index} className="user-item">
                  <span className="online-dot">🟢</span>
                  {user}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Messages Area */}
        <div className="messages-container">
          {/* Tab Selector */}
          <div className="chat-tabs">
            <button 
              className={`tab-button ${activeTab === 'room' ? 'active-tab' : ''}`}
              onClick={() => {
                setActiveTab('room');
                setUnreadCounts(prev => ({...prev, [room]: 0}));
              }}
            >
              Room Chat
              {getUnreadCount(room) > 0 && (
                <span className="tab-unread-badge">{getUnreadCount(room)}</span>
              )}
            </button>
            <button 
              className={`tab-button ${activeTab === 'private' ? 'active-tab' : ''}`}
              onClick={() => {
                if (selectedUser) {
                  setActiveTab('private');
                  setUnreadCounts(prev => ({...prev, [`private_${selectedUser}`]: 0}));
                }
              }}
              disabled={!selectedUser}
            >
              Private Chat
              {selectedUser && getUnreadCount(selectedUser, 'private') > 0 && (
                <span className="tab-unread-badge">{getUnreadCount(selectedUser, 'private')}</span>
              )}
            </button>
          </div>

          <div className="messages">
            {getFilteredMessages().map((msg, index) => (
              <div 
                key={index} 
                className={`message ${msg.isSystem ? 'system-message' : ''} ${
                  msg.from === username || msg.username === username ? 'own-message' : 'other-message'
                } ${msg.type === 'private' ? 'private-message' : ''}`}
              >
                <div className="message-header">
                  <strong>
                    {msg.type === 'private' ? 
                      (msg.from === username ? `To: ${selectedUser}` : `From: ${msg.from}`) 
                      : msg.username
                    }
                  </strong>
                  <span className="timestamp">{msg.timestamp}</span>
                </div>
                <div className="message-content">{msg.message}</div>
                {msg.type === 'private' && (
                  <div className="private-badge-small">🔒</div>
                )}
              </div>
            ))}
            
            {/* Typing Indicators */}
            {isTyping && activeTab === 'room' && (
              <div className="typing-indicator">
                {isTyping}
              </div>
            )}
            
            {privateTyping && activeTab === 'private' && (
              <div className="typing-indicator">
                {privateTyping}
              </div>
            )}
            
            {getFilteredMessages().length === 0 && (
              <div className="no-messages">
                {activeTab === 'room' 
                  ? `No messages in #${room} yet. Start the conversation!`
                  : selectedUser 
                    ? `No messages with ${selectedUser} yet. Say hello!`
                    : 'Select a user to start private messaging'
                }
              </div>
            )}
            
            <div ref={messagesEndRef} />
          </div>

          {/* Message Input */}
          {activeTab === 'room' ? (
            <form onSubmit={sendMessage} className="message-form">
              <input
                type="text"
                placeholder={`Type your message in #${room}...`}
                value={message}
                onChange={(e) => {
                  setMessage(e.target.value);
                  handleTyping();
                }}
                className="message-input"
                disabled={!isConnected}
              />
              <button 
                type="submit" 
                className="send-btn"
                disabled={!isConnected || !message.trim()}
              >
                Send
              </button>
            </form>
          ) : (
            <form onSubmit={sendPrivateMessage} className="message-form">
              <input
                type="text"
                placeholder={selectedUser ? `Private message to ${selectedUser}...` : 'Select a user to message...'}
                value={privateMessage}
                onChange={(e) => {
                  setPrivateMessage(e.target.value);
                  handlePrivateTyping();
                }}
                className="message-input"
                disabled={!isConnected || !selectedUser}
              />
              <button 
                type="submit" 
                className="send-btn private-send-btn"
                disabled={!isConnected || !selectedUser || !privateMessage.trim()}
              >
                Send Private
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

export default App;
