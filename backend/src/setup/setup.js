require('dotenv').config({ path: '.env' });
require('dotenv').config({ path: '.env.local' });

const mongoose = require('mongoose');
mongoose.connect(process.env.DATABASE);

const resetDb = require('./resetDb');

async function setupApp() {
  try {
    await resetDb();
    console.log('🥳 Setup completed: Success!');
    process.exit();
  } catch (e) {
    console.log('\n🚫 Error! The Error info is below');
    console.log(e);
    process.exit(1);
  }
}

setupApp();
