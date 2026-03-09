const express = require("express");
const router = express.Router();
const bcrypt = require("bcryptjs");
const User = require("../models/User");
const multer = require("multer");
const path = require("path");
const { isAuthenticated } = require("../middleware/auth");

// Multer setup for avatar
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, "public/uploads"),
  filename: (req, file, cb) => {
    cb(null, `avatar-${Date.now()}${path.extname(file.originalname)}`);
  },
});
const upload = multer({ storage });

// GET /signup
router.get("/signup", (req, res) => {
  const errors = req.flash("error");
  res.render("user/signup", { errors });
});

// POST /signup
router.post("/signup", async (req, res) => {
  try {
    const { username, email, password, confirmPassword } = req.body;

    if (password !== confirmPassword) {
      req.flash("error", "Passwords do not match.");
      return res.redirect("/signup");
    }

    const existingUser = await User.findOne({ $or: [{ email }, { username }] });
    if (existingUser) {
      req.flash("error", "Username or Email already in use.");
      return res.redirect("/signup");
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = new User({ username, email, password: hashedPassword });
    await user.save();

    req.flash("success", "Account created! Please log in.");
    res.redirect("/login");
  } catch (err) {
    console.error(err);
    req.flash("error", "Something went wrong. Try again.");
    res.redirect("/signup");
  }
});

// GET /login
router.get("/login", (req, res) => {
  const errors = req.flash("error");
  const success = req.flash("success");
  res.render("user/login", { errors, success });
});

// POST /login
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({ email });
    if (!user) {
      req.flash("error", "No account found with that email.");
      return res.redirect("/login");
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      req.flash("error", "Incorrect password.");
      return res.redirect("/login");
    }

    // Set session
    req.session.user = {
      _id: user._id,
      username: user.username,
      email: user.email,
      avatar: user.avatar,
    };

    res.redirect("/");
  } catch (err) {
    console.error(err);
    req.flash("error", "Something went wrong. Try again.");
    res.redirect("/login");
  }
});

// GET /profile
router.get("/profile", isAuthenticated, (req, res) => {
  res.render("user/profile", { currentUser: req.session.user });
});

// POST /profile/update - Handle avatar upload
router.post("/profile/update", isAuthenticated, upload.single("avatar"), async (req, res) => {
  try {
    const userId = req.session.user._id;
    let updateData = {};
    
    if (req.file) {
      updateData.avatar = `/uploads/${req.file.filename}`;
    }

    const updatedUser = await User.findByIdAndUpdate(userId, updateData, { new: true });
    
    // Update session
    req.session.user.avatar = updatedUser.avatar;

    // Notify all clients that a user has updated their profile
    req.app.get("io").emit("userUpdated", {
      userId: updatedUser._id,
      username: updatedUser.username,
      avatar: updatedUser.avatar
    });
    
    req.flash("success", "Profile updated successfully!");
    res.redirect("/profile");
  } catch (err) {
    console.error(err);
    req.flash("error", "Failed to update profile.");
    res.redirect("/profile");
  }
});

// GET /logout
router.get("/logout", async (req, res) => {
  try {
    if (req.session.user) {
      await User.findByIdAndUpdate(req.session.user._id, { isOnline: false, lastSeen: new Date() });
    }
  } catch (e) { /* ignore */ }

  req.session.destroy(() => {
    res.redirect("/login");
  });
});

module.exports = router;