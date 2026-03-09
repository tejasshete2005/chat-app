const express = require("express");
const router = express.Router();
const Chat = require("../models/Chat");
const User = require("../models/User");
const Message = require("../models/Message");
const { isAuthenticated } = require("../middleware/auth");

// 1. Fetch all chats for logged-in user
router.get("/", isAuthenticated, async (req, res) => {
  try {
    let chats = await Chat.find({ users: { $elemMatch: { $eq: req.session.user._id } } })
      .populate("users", "-password")
      .populate("groupAdmin", "-password")
      .populate("latestMessage")
      .sort({ updatedAt: -1 });

    const chatsWithUnread = await Promise.all(chats.map(async (chat) => {
      const unreadCount = await Message.countDocuments({
        chatId: chat._id,
        readBy: { $ne: req.session.user._id }
      });
      return { ...chat._doc, unreadCount };
    }));

    res.json(chatsWithUnread);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch chats" });
  }
});

// 2. Fetch or create a 1-on-1 chat
router.post("/direct", isAuthenticated, async (req, res) => {
  const { userId } = req.body; // the other user's ID
  
  if (!userId) return res.status(400).json({ error: "User ID required" });

  try {
    const isChat = await Chat.find({
      isGroupChat: false,
      $and: [
        { users: { $elemMatch: { $eq: req.session.user._id } } },
        { users: { $elemMatch: { $eq: userId } } },
      ],
    })
      .populate("users", "-password")
      .populate("latestMessage");

    if (isChat.length > 0) {
      return res.json(isChat[0]);
    } else {
      const chatData = {
        chatName: "sender",
        isGroupChat: false,
        users: [req.session.user._id, userId],
      };

      const createdChat = await Chat.create(chatData);
      const fullChat = await Chat.findOne({ _id: createdChat._id }).populate("users", "-password");
      res.json(fullChat);
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Could not create direct chat" });
  }
});

// 3. Create Group Chat
router.post("/group/create", isAuthenticated, async (req, res) => {
  const { name, users } = req.body;
  
  if (!name || !users || users.length < 1) {
    return res.status(400).json({ error: "Group name and at least 1 other user required." });
  }

  try {
    const parsedUsers = JSON.parse(users);
    parsedUsers.push(req.session.user._id); // Add self to the group list

    const groupChat = await Chat.create({
      chatName: name,
      users: parsedUsers,
      isGroupChat: true,
      groupAdmin: req.session.user._id,
    });

    const fullGroupChat = await Chat.findOne({ _id: groupChat._id })
      .populate("users", "-password")
      .populate("groupAdmin", "-password");

    res.json(fullGroupChat);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to create group" });
  }
});

// 4. Group Action: Add User
router.put("/group/add", isAuthenticated, async (req, res) => {
  const { chatId, userId } = req.body;

  const chat = await Chat.findById(chatId);
  if (!chat.isGroupChat) return res.status(400).json({ error: "Not a group chat" });
  if (chat.groupAdmin.toString() !== req.session.user._id) return res.status(403).json({ error: "Only admin can add members" });

  try {
    const added = await Chat.findByIdAndUpdate(chatId, { $addToSet: { users: userId } }, { new: true })
      .populate("users", "-password")
      .populate("groupAdmin", "-password");
      
    res.json(added);
  } catch (err) {
    res.status(500).json({ error: "Failed to add to group" });
  }
});

// 5. Group Action: Remove User / Leave
router.put("/group/remove", isAuthenticated, async (req, res) => {
  const { chatId, userId } = req.body; // userId to remove

  const chat = await Chat.findById(chatId);
  if (!chat.isGroupChat) return res.status(400).json({ error: "Not a group chat" });
  
  // Can only remove if you are the admin, OR you are removing yourself (leaving)
  if (chat.groupAdmin.toString() !== req.session.user._id && userId !== req.session.user._id) {
    return res.status(403).json({ error: "Only admin can remove other members" });
  }

  // Prevent admin from removing themselves if there are other members and no new admin assigned 
  // (We'll simplify: just removing them is fine for now, or assign randomly)
  if (chat.groupAdmin.toString() === userId && chat.users.length > 1) {
    // Optionally handle transferring adminship. We'll skip for simple functionality.
  }

  try {
    const removed = await Chat.findByIdAndUpdate(chatId, { $pull: { users: userId } }, { new: true })
      .populate("users", "-password")
      .populate("groupAdmin", "-password");

    res.json(removed);
  } catch (err) {
    res.status(500).json({ error: "Failed to remove from group" });
  }
});

// 6. Fetch Messages for a Chat
router.get("/:chatId/messages", isAuthenticated, async (req, res) => {
  try {
    // Mark all unread/undelivered messages in this chat as read/delivered by this user
    const userId = req.session.user._id;
    await Message.updateMany(
      { 
        chatId: req.params.chatId, 
        $or: [
          { readBy: { $ne: userId } },
          { deliveredTo: { $ne: userId } }
        ]
      },
      { $addToSet: { readBy: userId, deliveredTo: userId } }
    );

    const messages = await Message.find({ 
      chatId: req.params.chatId,
      deletedBy: { $ne: userId }
    })
      .sort({ createdAt: 1 }) // oldest first
      .populate("senderId", "username avatar");
      
    res.json(messages);
  } catch (err) {
    res.status(500).json({ error: "Failed to load messages" });
  }
});

module.exports = router;
