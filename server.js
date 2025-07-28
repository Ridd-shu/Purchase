require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();

// Middleware
app.use(cors({ origin: 'http://localhost:5000' }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static('uploads'));

// Ensure uploads directory exists
if (!fs.existsSync('uploads')) fs.mkdirSync('uploads');

// MongoDB connection
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/purchase_records', {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(() => console.log('✅ MongoDB connected'))
  .catch(err => {
    console.error('❌ MongoDB connection failed:', err.message);
    process.exit(1);
  });

// Schemas
const productSchema = new mongoose.Schema({
  productName: String,
  unitPrice: Number,
  quantity: Number,
  totalPrice: Number
});

const purchaseSchema = new mongoose.Schema({
  buyerName: String,
  email: String,
  purchaseDate: Date,
  platform: String,
  gst: { type: String, enum: ['Yes', 'No'] },
  invoiceNumber: String,
  products: [productSchema],
  grandTotal: Number,
  notes: String,
  orderNumber: String,
  billUpload: {
    filename: String,
    path: String,
    size: Number,
    mimetype: String
  }
}, { timestamps: true });

// Auto-generate order number
purchaseSchema.pre('save', async function (next) {
  if (this.isNew) {
    const count = await mongoose.model('Purchase').countDocuments();
    this.orderNumber = `BM-${Date.now()}-${String(count + 1).padStart(4, '0')}`;
  }
  next();
});

const PurchaseOrder = mongoose.model('Purchase', purchaseSchema);

// Multer setup
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads'),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const name = `${Date.now()}-${Math.round(Math.random() * 1E9)}${ext}`;
    cb(null, name);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 30 * 1024 * 1024 }, // 30MB
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif'];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Invalid file type. Only JPG, JPEG, PNG, and GIF are allowed.'));
  }
});

// Routes
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', message: 'Server running', timestamp: new Date() });
});

// POST Purchase Order
app.post('/api/purchase', upload.single('billUpload'), async (req, res) => {
  try {
    const {
      buyerName,
      email,
      purchaseDate,
      platform,
      gst,
      invoiceNumber,
      notes,
      grandTotal,
      ...rest
    } = req.body;

    if (!buyerName || !email || !purchaseDate || !platform || !gst) {
      return res.status(400).json({ success: false, error: 'Missing required fields' });
    }

    // Extract products from dynamic fields
    const products = [];
    let index = 1;

    while (rest[`productName${index}`]) {
      const name = rest[`productName${index}`];
      const unitPrice = parseFloat(rest[`unitPrice${index}`]) || 0;
      const quantity = parseInt(rest[`quantity${index}`]) || 1;
      const totalPrice = parseFloat(rest[`totalPrice${index}`]) || unitPrice * quantity;

      if (name && unitPrice > 0) {
        products.push({
          productName: name,
          unitPrice,
          quantity,
          totalPrice
        });
      }
      index++;
    }

    if (products.length === 0) {
      return res.status(400).json({ success: false, error: 'At least one product is required' });
    }

    const finalGrandTotal = grandTotal ? parseFloat(grandTotal) : products.reduce((sum, p) => sum + p.totalPrice, 0);

    const newOrder = new PurchaseOrder({
      buyerName,
      email,
      purchaseDate: new Date(purchaseDate),
      platform,
      gst,
      invoiceNumber,
      notes,
      products,
      grandTotal: finalGrandTotal
    });

    if (req.file) {
      newOrder.billUpload = {
        filename: req.file.filename,
        path: req.file.path,
        size: req.file.size,
        mimetype: req.file.mimetype
      };
    }

    await newOrder.save();

    res.status(201).json({
      success: true,
      message: 'Purchase order saved successfully',
      orderNumber: newOrder.orderNumber
    });

  } catch (err) {
    console.error('Error saving order:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET all purchase orders
app.get('/api/purchase', async (req, res) => {
  try {
    const orders = await PurchaseOrder.find().sort({ createdAt: -1 });
    res.json({ success: true, count: orders.length, data: orders });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Start server
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
});
