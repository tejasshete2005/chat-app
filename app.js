require("dotenv").config();

const express = require("express");
const app = express();
const mongoose = require("mongoose");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const session = require("express-session");
const MongoStore = require('connect-mongo').default || require('connect-mongo');
const flash = require("connect-flash");
const multer = require("multer");
const fs = require("fs");

const Message = require("./models/Message");
const User = require("./models/User");
const Chat = require("./models/Chat");
const authRoutes = require("./routes/auth");
const chatRoutes = require("./routes/chatRoutes");
const { isAuthenticated } = require("./middleware/auth");

const server = http.createServer(app);
const io = new Server(server, {
  maxHttpBufferSize: 10 * 1024 * 1024, // 10 MB for media
});

app.set("io", io);

// --- View Engine ---
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

// --- Static Files ---
app.use(express.static(path.join(__dirname, "public")));

// --- Body Parsers ---
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// --- Session ---
let store;
try {
  if (process.env.MONGO_URI) {
    const storeOptions = {
      mongoUrl: process.env.MONGO_URI,
      crypto: {
        secret: process.env.SESSION_SECRET || "chatapp_secret_key_2024"
      },
      touchAfter: 24 * 3600,
    };
    
    // Attempt to create the store with various import patterns
    if (typeof MongoStore.create === 'function') {
      store = MongoStore.create(storeOptions);
    } else if (typeof MongoStore === 'function') {
      store = new MongoStore(storeOptions);
    }
  }
} catch (err) {
  console.error("Failed to initialize MongoStore:", err);
}

app.use(
  session({
    store: store, // Defaults to MemoryStore if store is undefined
    secret: process.env.SESSION_SECRET || "chatapp_secret_key_2024",
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 1000 * 60 * 60 * 24 }, // 1 day
  })
);



// --- Flash ---
app.use(flash());

// --- Global locals ---
app.use((req, res, next) => {
  res.locals.currentUser = req.session.user || null;
  next();
});

// --- Multer (file uploads) ---
const uploadsDir = path.join(__dirname, "public", "uploads");
try {
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }
} catch (err) {
  console.warn("⚠️  Warning: Could not create uploads directory. This is expected on read-only systems like Vercel. Ensure you use cloud storage for production.");
}

const storage = multer.memoryStorage();

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|gif|webp|mp4|pdf|doc|docx|txt|zip|rar/;
    const ext = path.extname(file.originalname).toLowerCase().slice(1);
    if (allowed.test(ext)) {
      cb(null, true);
    } else {
      cb(new Error("File type not allowed"));
    }
  },
});

// --- DB ---
if (!process.env.MONGO_URI) {
  console.error("❌ Error: MONGO_URI is not defined in environment variables.");
} else {
  // Debug: Log the URI (hiding password) to verify it's being read correctly
  const maskedUri = process.env.MONGO_URI.replace(/:([^:@]{1,})@/, ':****@');
  console.log(`📡 Attempting to connect to: ${maskedUri}`);

  mongoose
    .connect(process.env.MONGO_URI, {
      serverSelectionTimeoutMS: 5000, 
      connectTimeoutMS: 10000,
    })
    .then(() => console.log("✅ MongoDB Connected Successfully"))
    .catch((err) => {
      console.error("❌ DB Connection Error details:");
      console.error("- Message:", err.message);
      console.error("- Code:", err.code);
      if (err.message.includes("SSL alert number 80")) {
        console.error("💡 Hint: SSL Alert 80 usually means your IP is not whitelisted in MongoDB Atlas or your password contains special characters that need encoding.");
      }
    });
}

// --- Routes ---
app.use("/", authRoutes);
app.use("/api/chats", chatRoutes);

// Home → Chat Dashboard
app.get("/", isAuthenticated, async (req, res) => {
  try {
    // Fetch all registered users to start private chats
    const allUsers = await User.find({ _id: { $ne: req.session.user._id } })
                               .select("-password").sort({ username: 1 });
    
    // We'll fetch active chats dynamically on the client
    res.render("chat", {
      allUsers,
      currentUser: req.session.user,
      room: null,
    });
  } catch (err) {
    console.error("Home route error:", err);
    res.render("chat", {
      allUsers: [],
      currentUser: req.session.user,
      room: null,
      error: "Database connection failed. Please try again later."
    });
  }
});

// Media upload endpoint -> requires chatId now
app.post("/upload", isAuthenticated, upload.single("media"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    const { chatId } = req.body;
    if (!chatId) return res.status(400).json({ error: "Chat ID required" });

    const mediaUrl = `/uploads/${req.file.filename}`;
    const mediaName = req.file.originalname;
    const mimeType = req.file.mimetype;
    const messageType = mimeType.startsWith("image/") ? "image" : "file";

    const msg = new Message({
      sender: req.session.user.username,
      senderId: req.session.user._id,
      content: mediaName,
      chatId: chatId,
      messageType,
      mediaUrl,
      mediaName,
      readBy: [req.session.user._id],
      deliveredTo: [req.session.user._id]
    });

    await msg.save();
    
    // Update latest message on chat
    await Chat.findByIdAndUpdate(chatId, { latestMessage: msg._id });

    // Broadcast via socket - populating senderId
    const populatedMsg = await Message.findById(msg._id).populate("senderId", "username avatar");

    io.to(chatId).emit("receiveMessage", populatedMsg);

    res.json({ success: true, mediaUrl, mediaName, messageType, message: populatedMsg });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Upload failed" });
  }
});

// --- Socket.IO ---
const onlineUsers = new Map(); // socketId -> { username, userId, avatar }

io.on("connection", (socket) => {
  console.log("🔌 Socket connected:", socket.id);

  // User connects logic
  socket.on("setup", async ({ username, userId, avatar }) => {
    socket.data.username = username;
    socket.data.userId = userId;

    onlineUsers.set(socket.id, { socketId: socket.id, username, userId, avatar: avatar || "" });
    socket.join(userId); // Join personal room for 1-1 targeted webRTC/invites
    
    try {
      await User.findByIdAndUpdate(userId, { isOnline: true });
    } catch (e) {}

    io.emit("updateOnlineUsers", Array.from(onlineUsers.values()));
  });

  // Join a specific chat room (1-1 or group)
  socket.on("joinChat", (chatId) => {
    socket.join(chatId);
    console.log(`User ${socket.data.username} joined chat: ${chatId}`);
  });

  // Send text message
  socket.on("sendMessage", async (data) => {
    try {
      const msg = new Message({
        sender: data.sender,
        senderId: data.senderId,
        content: data.content,
        chatId: data.chatId,
        messageType: data.messageType || "text",
        readBy: [data.senderId],
        deliveredTo: [data.senderId]
      });
      await msg.save();
      
      // Update Chat's latest message
      await Chat.findByIdAndUpdate(data.chatId, { latestMessage: msg._id });

      const populatedMsg = await Message.findById(msg._id).populate("senderId", "username avatar");

      io.to(data.chatId).emit("receiveMessage", populatedMsg);
    } catch (err) {
      console.error("Message save error:", err);
    }
  });

  // Message Status Updates
  socket.on("messageDelivered", async ({ messageId, userId, chatId }) => {
    try {
      const msg = await Message.findByIdAndUpdate(
        messageId, 
        { $addToSet: { deliveredTo: userId } }, 
        { new: true }
      );
      if (msg) {
        io.to(chatId).emit("messageStatusUpdate", { 
          messageId, 
          deliveredTo: msg.deliveredTo, 
          readBy: msg.readBy 
        });
      }
    } catch (e) {}
  });

  socket.on("messageRead", async ({ messageId, userId, chatId }) => {
    try {
      const msg = await Message.findByIdAndUpdate(
        messageId, 
        { $addToSet: { readBy: userId, deliveredTo: userId } }, 
        { new: true }
      );
      if (msg) {
        io.to(chatId).emit("messageStatusUpdate", { 
          messageId, 
          deliveredTo: msg.deliveredTo, 
          readBy: msg.readBy 
        });
      }
    } catch (e) {}
  });

  socket.on("readChat", async ({ chatId, userId }) => {
    try {
      await Message.updateMany(
        { chatId, readBy: { $ne: userId } },
        { $addToSet: { readBy: userId, deliveredTo: userId } }
      );
      io.to(chatId).emit("chatRead", { chatId, userId });
    } catch (e) {}
  });

  // Edit Message
  socket.on("editMessage", async ({ messageId, content, chatId, userId }) => {
    try {
      const msg = await Message.findById(messageId);
      if (!msg) return;

      // Security: Only sender can edit
      if (msg.senderId.toString() !== userId) return;

      msg.content = content;
      msg.isEdited = true;
      await msg.save();
      
      const populatedMsg = await Message.findById(msg._id).populate("senderId", "username avatar");
      io.to(chatId).emit("messageEdited", populatedMsg);
    } catch (e) {
      console.error("Edit message error:", e);
    }
  });

  // Delete Message
  socket.on("deleteMessage", async ({ messageId, chatId, userId, deleteForEveryone }) => {
    try {
      const msg = await Message.findById(messageId);
      if (!msg) return;

      if (deleteForEveryone) {
        // Security: Only sender can delete for everyone
        if (msg.senderId.toString() !== userId) {
          // If receiver tries to delete for everyone, force it to be "Delete for Me"
          await Message.findByIdAndUpdate(messageId, { $addToSet: { deletedBy: userId } });
          socket.emit("messageDeletedMe", { messageId, chatId });
          return;
        }

        const updatedMsg = await Message.findByIdAndUpdate(
          messageId,
          { isDeletedEveryone: true, content: "This message was deleted", mediaUrl: "", mediaName: "", messageType: "text" },
          { new: true }
        );
        if (updatedMsg) io.to(chatId).emit("messageDeletedEveryone", { messageId, chatId });
      } else {
        await Message.findByIdAndUpdate(
          messageId,
          { $addToSet: { deletedBy: userId } }
        );
        socket.emit("messageDeletedMe", { messageId, chatId });
      }
    } catch (e) {
      console.error("Delete message error:", e);
    }
  });

  // Typing indicator
  socket.on("typing", ({ username, chatId, isTyping }) => {
    socket.to(chatId).emit("typingStatus", { username, isTyping });
  });

  // --- WebRTC Video/Voice Signaling ---
  socket.on("callUser", (data) => {
    io.to(data.userToCall).emit("incomingCall", {
      signal: data.signalData,
      from: data.from,
      name: data.name,
      isVideo: data.isVideo
    });
  });

  socket.on("answerCall", (data) => {
    io.to(data.to).emit("callAccepted", data.signal);
  });

  socket.on("rejectCall", (data) => {
    io.to(data.to).emit("callRejected");
  });

  socket.on("endCall", (data) => {
    io.to(data.to).emit("callEnded");
  });
  
  socket.on("iceCandidate", (data) => {
    io.to(data.to).emit("iceCandidate", {
      candidate: data.candidate
    });
  });

  // Disconnect
  socket.on("disconnect", async () => {
    const user = onlineUsers.get(socket.id);
    if (user) {
      onlineUsers.delete(socket.id);

      // Update DB
      try {
        await User.findByIdAndUpdate(user.userId, {
          isOnline: false,
          lastSeen: new Date(),
        });
      } catch (e) {}

      // Broadcast updated list
      io.emit("updateOnlineUsers", Array.from(onlineUsers.values()));

      socket.to(socket.data.room || "general").emit("userActivity", {
        type: "leave",
        username: user.username,
      });
    }
  });
});

// --- Start Server ---
const PORT = process.env.PORT || 3000;
if (process.env.NODE_ENV !== 'production') {
  server.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
  });
}

module.exports = app;
