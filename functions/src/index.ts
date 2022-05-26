import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import algoliasearch from "algoliasearch";

// Set up Firestore
admin.initializeApp();

// Set up Algolia
// The app id and API key are coming from the cloud functions environment
const appId = functions.config().app.id;
const apiKey = functions.config().app.key;
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

// // Start writing Firebase Functions
// // https://firebase.google.com/docs/functions/typescript
//
// export const helloWorld = functions.https.onRequest((request, response) => {
//   functions.logger.info("Hello logs!", {structuredData: true});
//   response.send("Hello from Firebase!");
// });
