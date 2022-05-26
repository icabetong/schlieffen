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
type UserRequest= User & {
  token: string,
}
exports.createUser = functions.https.onCall(async (data: UserRequest, c) => {
  const {token, ...user} = data;

  try {
    const decodedToken = await admin.auth().verifyIdToken(token);
    const userDoc = await admin.firestore().collection("users")
        .doc(decodedToken.uid).get();

    if (userDoc.exists) {
      const userData = userDoc.data() as UserData;
      if (hasPermission(userData.permissions, 16)) {
        const password = randomPassword();
        const createdUser = await admin.auth().createUser({
          uid: userData.userId,
          email: user.email,
          password: password,
        });
        const newUser: UserData = {
          ...user,
          userId: createdUser.uid,
        };
        await admin.firestore().collection("users")
            .doc(newUser.userId).set(newUser);

        const transporter = nodemailer.createTransport({
          service: "gmail",
          auth: {
            user: source,
            pass: passkey,
          },
        });
        const email = {
          from: source,
          to: newUser.email,
          subject: "Your New Ludendorff Account",
          html: `Use this password for your account: 
          <strong>${password}</strong>`
        };

        await transporter.sendMail(email);
      } else throw Error();
    }
  } catch (error) {
      throw new functions.https.HttpsError(
        "unknown", `${error}`, error
      );
  }
});

/**
 * 
 * @param permissions the array of permissions 
 * @param permission  the permission itself
 * @returns true if the permission requested is in the permission array
 */
function hasPermission(permissions: number[], permission: number) {
  return permissions.includes(permission) ||
    permissions.includes(32);
}
/**
 * 
 * @returns a random generated user id string
 */
function randomUserId() {
  const characters = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let id = "";
  for (let i = 0; i < 28; i++) {
    id += characters.charAt(Math.floor(Math.random() * characters.length));
  }
  return id;
}
/**
 * 
 * @returns a secure random generated password string
 */
function randomPassword() {
  const characters = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*_-+=";
  let password = "";
  for (let i = 0; i < 8; i++) {
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
