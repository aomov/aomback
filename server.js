import express from "express";
import cors from "cors";
import multer from "multer";
import mongoose from 'mongoose';
import { v2 as cloudinary } from 'cloudinary';
import { CloudinaryStorage } from 'multer-storage-cloudinary';

// Helper function to safely destroy Cloudinary resource
const safeCloudinaryDestroy = async (publicId, resourceType = 'image') => {
  if (publicId) {
    try {
      await cloudinary.uploader.destroy(publicId, { resource_type: resourceType });
    } catch (e) {
      console.warn(`Could not destroy Cloudinary asset ${publicId}:`, e);
    }
  }
};

// --- CLOUDINARY CONFIGURATION ---
cloudinary.config({
  cloud_name: 'dqbaut17p',
  api_key: '917942585385597',
  api_secret: '3qo4mrlpo2bfuqScbgWlDY4SjgM',
});

// --- MONGODB CONFIGURATION ---
const MONGODB_URI = "mongodb+srv://aomwebsite_db_user:Letmesee@cluster0.xrwtaf2.mongodb.net/aomevents?retryWrites=true&w=majority";
const PORT = process.env.PORT || 5001;

// --- MONGOOSE SCHEMA ---

// Events Schema
const eventSchema = new mongoose.Schema({
  eventName: { type: String, required: true, trim: true },
  eventMainPicture: { type: String, required: true }, // Cloudinary URL
  eventMainPicturePublicId: { type: String, required: true },
  eventDescription: { type: String, required: true, trim: true },
  eventDate: { type: Date, required: true },
  eventType: { 
    type: String, 
    required: true, 
    enum: ['upcoming', 'past'],
    trim: true 
  },
  eventVideo: { type: String, required: false }, // Cloudinary URL (optional)
  eventVideoPublicId: { type: String, required: false },
  eventGallery: [{ 
    url: { type: String, required: true },
    publicId: { type: String, required: true }
  }], // Array of gallery images (optional)
  uploadDate: { type: Date, default: Date.now },
}, { timestamps: true });

// --- MODEL ---
const Event = mongoose.model('Event', eventSchema);

// --- EXPRESS APP SETUP ---
const app = express();

// --- ENHANCED CORS MIDDLEWARE ---
app.use(cors({
  origin: '*',
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With", "Accept"],
  credentials: false,
  optionsSuccessStatus: 200
}));

// Handle preflight requests
app.options('*', cors());

app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));

// --- DATABASE CONNECTION CHECK MIDDLEWARE ---
const checkDbConnection = (req, res, next) => {
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({ 
      error: "Database unavailable", 
      message: "MongoDB connection is not ready. Please try again later." 
    });
  }
  next();
};

// --- CLOUDINARY MULTER SETUP ---

// For Images (main picture and gallery)
const imageStorage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: 'aom-events/images',
    allowed_formats: ['jpg', 'png', 'jpeg', 'gif', 'webp'],
    public_id: (req, file) => {
      const timestamp = Date.now();
      const safeName = file.originalname.replace(/\s+/g, '_').replace(/[^\w.-]/g, '');
      return `${timestamp}-${safeName.split('.')[0]}`;
    },
  }
});

// For Videos
const videoStorage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: 'aom-events/videos',
    resource_type: 'video',
    allowed_formats: ['mp4', 'mov', 'avi', 'mkv', 'webm'],
    public_id: (req, file) => {
      const timestamp = Date.now();
      const safeName = file.originalname.replace(/\s+/g, '_').replace(/[^\w.-]/g, '');
      return `${timestamp}-${safeName.split('.')[0]}`;
    },
  }
});

const uploadImage = multer({
  storage: imageStorage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed!'), false);
    }
  }
});

const uploadVideo = multer({
  storage: videoStorage,
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('video/')) {
      cb(null, true);
    } else {
      cb(new Error('Only video files are allowed!'), false);
    }
  }
});

// --- ROUTES ---

app.get("/", (req, res) => {
  res.json({
    message: "AOM Events Backend API ✅",
    timestamp: new Date().toISOString(),
    database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected'
  });
});

// ========== EVENTS ROUTES ==========

// CREATE Event
app.post("/events/upload", checkDbConnection, uploadImage.fields([
  { name: 'mainPicture', maxCount: 1 },
  { name: 'gallery', maxCount: 10 }
]), async (req, res) => {
  console.log('🎉 Event upload request');
  
  try {
    const { eventName, eventDescription, eventDate, eventType } = req.body;

    // Validation
    if (!eventName || !eventDescription || !eventDate || !eventType) {
      return res.status(400).json({ 
        error: "Event name, description, date, and type (upcoming/past) are required" 
      });
    }

    if (!req.files || !req.files.mainPicture) {
      return res.status(400).json({ error: "Event main picture is required" });
    }

    // Validate event type
    if (!['upcoming', 'past'].includes(eventType)) {
      return res.status(400).json({ 
        error: "Event type must be either 'upcoming' or 'past'" 
      });
    }

    // Process main picture
    const mainPicture = req.files.mainPicture[0];
    
    // Process gallery (optional)
    let galleryImages = [];
    if (req.files.gallery) {
      galleryImages = req.files.gallery.map(file => ({
        url: file.path,
        publicId: file.filename
      }));
    }

    const newEvent = new Event({
      eventName: eventName.trim(),
      eventMainPicture: mainPicture.path,
      eventMainPicturePublicId: mainPicture.filename,
      eventDescription: eventDescription.trim(),
      eventDate: new Date(eventDate),
      eventType: eventType.trim(),
      eventGallery: galleryImages,
    });

    await newEvent.save();
    console.log(`✅ Event created: ${newEvent._id} (Type: ${eventType})`);

    res.status(201).json({
      message: "Event created successfully!",
      event: newEvent
    });

  } catch (error) {
    console.error('❌ Error creating event:', error);
    res.status(500).json({ error: "Failed to create event", details: error.message });
  }
});

// UPLOAD Event Video (separate endpoint)
app.post("/events/:id/video", checkDbConnection, uploadVideo.single('video'), async (req, res) => {
  console.log(`🎥 Uploading video for event: ${req.params.id}`);
  
  try {
    if (!req.file) {
      return res.status(400).json({ error: "Video file is required" });
    }

    const event = await Event.findById(req.params.id);
    if (!event) {
      return res.status(404).json({ error: "Event not found" });
    }

    // Delete old video if exists
    if (event.eventVideoPublicId) {
      await safeCloudinaryDestroy(event.eventVideoPublicId, 'video');
    }

    event.eventVideo = req.file.path;
    event.eventVideoPublicId = req.file.filename;

    await event.save();
    console.log(`✅ Video uploaded for event: ${req.params.id}`);

    res.json({
      message: "Event video uploaded successfully!",
      event
    });

  } catch (error) {
    console.error('❌ Error uploading video:', error);
    res.status(500).json({ error: "Failed to upload video", details: error.message });
  }
});

// GET All Events (with optional filter by type)
app.get("/events", checkDbConnection, async (req, res) => {
  try {
    const { type } = req.query; // ?type=upcoming or ?type=past
    
    let filter = {};
    if (type && ['upcoming', 'past'].includes(type)) {
      filter.eventType = type;
    }
    
    // Sort by event date (descending - newest first)
    const events = await Event.find(filter).sort({ eventDate: -1 });
    
    console.log(`📋 Fetched ${events.length} events${type ? ` (Type: ${type})` : ''}`);
    
    res.json({ events });
  } catch (error) {
    console.error('❌ Error fetching events:', error);
    res.status(500).json({ error: "Failed to fetch events" });
  }
});

// GET Single Event
app.get("/events/:id", checkDbConnection, async (req, res) => {
  try {
    const event = await Event.findById(req.params.id);
    if (!event) {
      return res.status(404).json({ error: "Event not found" });
    }
    res.json({ event });
  } catch (error) {
    console.error('❌ Error fetching event:', error);
    res.status(500).json({ error: "Failed to fetch event" });
  }
});

// EDIT Event (Full Update Support)
app.put("/events/:id", checkDbConnection, uploadImage.fields([
  { name: 'mainPicture', maxCount: 1 },
  { name: 'gallery', maxCount: 10 }
]), async (req, res) => {
  console.log(`✏️ Editing event: ${req.params.id}`);
  
  try {
    const { eventName, eventDescription, eventDate, eventType } = req.body;
    const event = await Event.findById(req.params.id);

    if (!event) {
      return res.status(404).json({ error: "Event not found" });
    }

    // Update text fields if provided
    if (eventName !== undefined) event.eventName = eventName.trim();
    if (eventDescription !== undefined) event.eventDescription = eventDescription.trim();
    if (eventDate !== undefined) event.eventDate = new Date(eventDate);
    
    // Update event type if provided
    if (eventType !== undefined) {
      if (!['upcoming', 'past'].includes(eventType)) {
        return res.status(400).json({ 
          error: "Event type must be either 'upcoming' or 'past'" 
        });
      }
      event.eventType = eventType.trim();
    }

    // Update main picture if new one is uploaded
    if (req.files && req.files.mainPicture) {
      console.log('🖼️ Replacing event main picture');
      await safeCloudinaryDestroy(event.eventMainPicturePublicId);
      const mainPicture = req.files.mainPicture[0];
      event.eventMainPicture = mainPicture.path;
      event.eventMainPicturePublicId = mainPicture.filename;
    }

    // Update gallery if new images are uploaded
    if (req.files && req.files.gallery) {
      console.log('🖼️ Updating event gallery');
      // Delete old gallery images
      for (const img of event.eventGallery) {
        await safeCloudinaryDestroy(img.publicId);
      }
      // Add new gallery images
      event.eventGallery = req.files.gallery.map(file => ({
        url: file.path,
        publicId: file.filename
      }));
    }

    await event.save();
    console.log(`✅ Event updated: ${req.params.id}`);

    res.json({ 
      message: "Event updated successfully", 
      event 
    });
  } catch (error) {
    console.error('❌ Error updating event:', error);
    res.status(500).json({ error: "Failed to update event", details: error.message });
  }
});

// DELETE Event
app.delete("/events/:id", checkDbConnection, async (req, res) => {
  console.log(`🗑️ Deleting event: ${req.params.id}`);
  
  try {
    const event = await Event.findById(req.params.id);
    if (!event) {
      return res.status(404).json({ error: "Event not found" });
    }

    // Delete main picture
    await safeCloudinaryDestroy(event.eventMainPicturePublicId);
    
    // Delete video if exists
    if (event.eventVideoPublicId) {
      await safeCloudinaryDestroy(event.eventVideoPublicId, 'video');
    }
    
    // Delete gallery images
    for (const img of event.eventGallery) {
      await safeCloudinaryDestroy(img.publicId);
    }

    await Event.findByIdAndDelete(req.params.id);
    console.log(`✅ Event deleted: ${req.params.id}`);

    res.json({ message: "Event deleted successfully" });
  } catch (error) {
    console.error('❌ Error deleting event:', error);
    res.status(500).json({ error: "Failed to delete event" });
  }
});

// --- Global Error Handling ---
app.use((error, req, res, next) => {
  console.error('💥 Error:', error);

  if (error instanceof multer.MulterError) {
    return res.status(400).json({ error: error.message });
  }

  res.status(500).json({ error: error.message || 'Something went wrong!' });
});

// --- 404 Handler ---
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// --- SERVER START & DB CONNECTION ---
const server = app.listen(PORT, () => {
  console.log(`\n🚀 AOM Events Server Running!`);
  console.log(`🌐 Server listening on port ${PORT}`);
  console.log(`\n📋 Endpoints:`);
  console.log(' ✅ Events: POST/GET/PUT/DELETE /events');
  console.log(' ✅ Upload Video: POST /events/:id/video');
  console.log(' ✅ Filter Events: GET /events?type=upcoming or GET /events?type=past');
  console.log('\n✏️  All resources support full EDIT functionality via PUT');
  
  mongoose.connect(MONGODB_URI, {
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 45000,
  })
  .then(() => {
    console.log('✅ Connected to MongoDB successfully!');
  })
  .catch(err => {
    console.error('❌ Initial MongoDB connection failed:', err.message);
    console.error('Full error:', err);
  });
});

// --- MONGOOSE CONNECTION EVENT HANDLERS ---
mongoose.connection.on('disconnected', () => {
  console.log('⚠️  MongoDB disconnected');
});

mongoose.connection.on('reconnected', () => {
  console.log('✅ MongoDB reconnected successfully!');
});

// --- GRACEFUL SHUTDOWN ---
const shutdown = async () => {
  console.log('\n🛑 Shutting down gracefully...');
  
  try {
    await mongoose.connection.close();
    console.log('✅ MongoDB connection closed');
  } catch (err) {
    console.error('❌ Error closing MongoDB connection:', err);
  }
  
  server.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);