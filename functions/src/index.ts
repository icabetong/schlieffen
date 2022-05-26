import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import * as nodemailer from "nodemailer";
import algoliasearch from "algoliasearch";

// Set up Firestore
admin.initializeApp();

// Set up Algolia
// The app id and API key are coming from the cloud functions environment
const appId = functions.config().app.id;
const apiKey = functions.config().app.key;
const source = functions.config().email.source;
const passkey = functions.config().email.password;
const algoliaClient = algoliasearch(appId, apiKey);

const inventoryIndex = algoliaClient.initIndex("inventories");
const issuedIndex = algoliaClient.initIndex("issued");
const stockCardIndex = algoliaClient.initIndex("cards");

type Data = {
  id: string,
  entries: any[],
}

exports.indexInventory = functions.https.onCall(async (data: Data, c) => {
  await inventoryIndex.partialUpdateObject({
    inventoryItems: data.entries,
    objectID: data.id,
  });
});

exports.indexIssued = functions.https.onCall(async (data: Data, c) => {
  await issuedIndex.partialUpdateObject({
    issuedItems: data.entries,
    objectID: data.id,
  });
});

exports.indexStockCard = functions.https.onCall(async (data: Data, c) => {
  await stockCardIndex.partialUpdateObject({
    entries: data.entries,
    objectID: data.id,
  });
});

type User = {
  email: string,
  firstName: string,
  lastName: string,
  position: string,
  permissions: number[]
}
type UserData = User & {
  userId: string
}
type UserRequestData = User & {
  token: string,
}
exports.createUser = functions.https.onCall(async (data: UserRequestData, c) => {
  const { token, ...user } = data;

  try {
    let decodedToken = await admin.auth().verifyIdToken(token);

    const userDoc = await admin.firestore().collection('users')
      .doc(decodedToken.uid).get();
    if (!userDoc.exists)
      throw Error();

    const userData = userDoc.data() as UserData;
    const newId = randomUserId();
    if (hasPermission(userData.permissions, 16)) {
      const newUser: UserData = {
        ...user,
        userId: newId,
      }

      const password = randomPassword();
      await admin.auth().createUser({
        uid: userData.userId,
        email: user.email,
        password: password,
      });
      await admin.firestore().collection('users')
        .doc(newId).set(newUser);

      const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
          user: source,
          pass: passkey,
        }
      });
      const email = {
        from: source,
        to: newUser.email,
        subject: "Your New Ludendorff Account",
        html: `Use this password for your account: <strong>${password}</strong>`
      }

      await transporter.sendMail(email);
    } else throw Error();
  } catch (error) {
    throw new functions.https.HttpsError(
      'unknown', `${error}`, error
    );
  }
});

function hasPermission(permissions: number[], permission: number) {
  return permissions.includes(permission) ||
    permissions.includes(32);
}
function randomUserId() {
  const characters = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  var id = '';
  for (var i = 0; i < 28; i++) {
    id += characters.charAt(Math.floor(Math.random() * characters.length));
  }
  return id;
}
function randomPassword() {
  const characters = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*_-+=";
  var password = '';
  for (var i = 0; i < 8; i++) {
    password += characters.charAt(Math.floor(Math.random() * characters.length));
  }
  return password;
}
// // Start writing Firebase Functions
// // https://firebase.google.com/docs/functions/typescript
//
// export const helloWorld = functions.https.onRequest((request, response) => {
//   functions.logger.info("Hello logs!", {structuredData: true});
//   response.send("Hello from Firebase!");
// });
