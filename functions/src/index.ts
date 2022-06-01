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
const passkey = functions.config().email.passkey;
const algoliaClient = algoliasearch(appId, apiKey);

const inventoryIndex = algoliaClient.initIndex("inventories");
const issuedIndex = algoliaClient.initIndex("issued");
const stockCardIndex = algoliaClient.initIndex("cards");

type Data = {
  id: string,
  entries: any[],
}

exports.indexInventory = functions.https.onCall(async (data: Data) => {
  await inventoryIndex.partialUpdateObject({
    inventoryItems: data.entries,
    objectID: data.id,
  });
});

exports.indexIssued = functions.https.onCall(async (data: Data) => {
  await issuedIndex.partialUpdateObject({
    issuedItems: data.entries,
    objectID: data.id,
  });
});

exports.indexStockCard = functions.https.onCall(async (data: Data) => {
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
exports.createUser = functions.https.onCall(async (data: UserRequest) => {
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

type ModifyUserRequest = {
  token: string,
  userId: string,
  disabled: boolean,
}
exports.modifyUser = functions.https.onCall(async (data: ModifyUserRequest) => {
  try {
    const decodedToken = await admin.auth().verifyIdToken(data.token);
    const userDoc = await admin.firestore().collection("users")
      .doc(decodedToken.uid).get();

    if (userDoc.exists) {
      const user = userDoc.data() as UserData;
      if (hasPermission(user.permissions, 16)) {
        await admin.auth().updateUser(data.userId, {
          disabled: data.disabled,
        });
        await admin.firestore().collection("users")
          .doc(data.userId).update({ disabled: data.disabled });
      } else throw Error();
    } else throw Error();
  } catch (error) {
    throw new functions.https.HttpsError(
      "unknown", `${error}`, error
    );
  }
});

type DeleteUserRequest = {
  token: string,
  userId: string
}
exports.deleteUser = functions.https.onCall(async (data: DeleteUserRequest) => {
  try {
    const decodedToken = await admin.auth().verifyIdToken(data.token);
    const userDoc = await admin.firestore().collection("users")
      .doc(decodedToken.uid).get();

    if (userDoc.exists) {
      const user = userDoc.data() as UserData;
      if (hasPermission(user.permissions, 16)) {
        await admin.auth().deleteUser(data.userId);
        await admin.firestore().collection("users")
          .doc(data.userId).delete();
      } else throw Error();
    } else throw Error();
  } catch (error) {
    throw new functions.https.HttpsError(
      "unknown", `${error}`, error
    );
  }
});

type AuthData = {
  userId: string,
  name: string,
  email: string,
}
type CategoryCore = {
  categoryId: string,
  categoryName?: string,
}
type Asset = {
  stockNumber: string,
  description?: string,
  category?: CategoryCore,
  subcategory?: string,
  unitOfMeasure?: string,
  unitValue: number,
  remarks?: string,
  auth?: AuthData
}
type InventoryReport = {
  inventoryReportId: string,
  fundCluster?: string,
  entityName?: string,
  entityPosition?: string,
  yearMonth?: string,
  accountabilityDate?: admin.firestore.Timestamp,
  auth?: AuthData
}
type IssuedReport = {
  issuedReportId: string,
  entityName?: string,
  fundCluster?: string,
  serialNumber?: string,
  date?: admin.firestore.Timestamp,
  auth?: AuthData
}
type StockCard = {
  stockCardId: string,
  entityName?: string,
  stockNumber?: string,
  description?: string,
  unitPrice: number,
  unitOfMeasure?: string,
  balances: any,
  auth?: AuthData
}
type FirestoreUser = UserData & {
  auth?: AuthData
}

type DataType = "asset" | "inventory" | "issued" | "stockCard" | "user";
type Operation = "create" | "update" | "remove";
type OperationData<T> = {
  before?: T,
  after?: T,
}
type LogEntry<T> = {
  logEntryId: string,
  user: AuthData,
  dataType: DataType,
  identifier: string,
  data?: OperationData<T>,
  timestamp: admin.firestore.Timestamp,
  operation: Operation,
}

exports.logAsset = functions.firestore.document("assets/{assetId}").onWrite(async (change) => {
  try {
    const { before, after } = change;

    if (before.exists && after.exists) {
      // update event
      const beforeData = before.data() as Asset;
      const afterData = after.data() as Asset;

      delete beforeData.auth;
      const { auth, ...asset } = afterData;
      if (!afterData?.auth) {
        functions.logger.error("asset:update: No AuthData defined");
        return;
      }

      const logEntry: LogEntry<Asset> = {
        logEntryId: randomId(),
        user: afterData.auth,
        dataType: "asset",
        identifier: beforeData.stockNumber,
        data: {
          before: beforeData,
          after: asset,
        },
        timestamp: admin.firestore.Timestamp.now(),
        operation: "update"
      }
  
      await admin.firestore().collection("logs").doc(logEntry.logEntryId).set(logEntry);
      await admin.firestore().collection("assets").doc(asset.stockNumber).update({
        auth: admin.firestore.FieldValue.delete()
      });

    } else if (!after.exists) {
      // delete event
      const beforeData = before.data() as Asset;
      const { auth, ...asset } = beforeData;
      if (!auth) {
        functions.logger.error("asset:remove: No AuthData defined");
        return;
      }

      delete beforeData.auth;
      const logEntry: LogEntry<Asset> = {
        logEntryId: randomId(),
        user: auth,
        dataType: "asset",
        identifier: asset.stockNumber,
        data: {
          before: asset,
        },
        timestamp: admin.firestore.Timestamp.now(),
        operation: "remove"
      }

      await admin.firestore().collection("logs").doc(logEntry.logEntryId).set(logEntry);
      await admin.firestore().collection("assets").doc(asset.stockNumber).update({
        auth: admin.firestore.FieldValue.delete()
      });

    } else {
      // create event
      const afterData = after.data() as Asset;
      const { auth, ...asset } = afterData;
      if (!auth) {
        functions.logger.error("asset:create: No AuthData defined");
        return;
      }

      const logEntry: LogEntry<Asset> = {
        logEntryId: randomId(),
        user: auth,
        dataType: "asset",
        identifier: afterData.stockNumber,
        data: {
          before: asset,
        },
        timestamp: admin.firestore.Timestamp.now(),
        operation: "create"
      }
      
      await admin.firestore().collection("logs").doc(logEntry.logEntryId).set(logEntry);
      await admin.firestore().collection("assets").doc(asset.stockNumber).update({
        auth: admin.firestore.FieldValue.delete()
      });

    }
  } catch (error) {
    functions.logger.error("asset:error:" + error);
  }
});
exports.logInventory = functions.firestore.document("inventories/{inventoryReportId}").onWrite(async (change) => {
  try {
    const { before, after } = change;

    if (before.exists && after.exists) {
      // update event
      const beforeData = before.data() as InventoryReport;
      const afterData = after.data() as InventoryReport;

      delete beforeData.auth;
      const { auth, ...report } = afterData;
      if (!afterData?.auth) {
        functions.logger.error("inventory:update: No AuthData defined");
        return;
      }

      const logEntry: LogEntry<InventoryReport> = {
        logEntryId: randomId(),
        user: afterData.auth,
        dataType: "inventory",
        identifier: beforeData.inventoryReportId,
        data: {
          before: beforeData,
          after: report,
        },
        timestamp: admin.firestore.Timestamp.now(),
        operation: "update"
      }
  
      await admin.firestore().collection("logs").doc(logEntry.logEntryId).set(logEntry);
      await admin.firestore().collection("inventories").doc(report.inventoryReportId).update({
        auth: admin.firestore.FieldValue.delete()
      });

    } else if (!after.exists) {
      // delete event
      const beforeData = before.data() as InventoryReport;
      const { auth, ...report } = beforeData;
      if (!auth) {
        functions.logger.error("inventory:remove: No AuthData defined");
        return;
      }

      delete beforeData.auth;
      const logEntry: LogEntry<InventoryReport> = {
        logEntryId: randomId(),
        user: auth,
        dataType: "inventory",
        identifier: report.inventoryReportId,
        data: {
          before: report,
        },
        timestamp: admin.firestore.Timestamp.now(),
        operation: "remove"
      }

      await admin.firestore().collection("logs").doc(logEntry.logEntryId).set(logEntry);
      await admin.firestore().collection("inventories").doc(report.inventoryReportId).update({
        auth: admin.firestore.FieldValue.delete()
      });

    } else {
      // create event
      const afterData = after.data() as InventoryReport;
      const { auth, ...report } = afterData;
      if (!auth) {
        functions.logger.error("inventory:create: No AuthData defined");
        return;
      }

      const logEntry: LogEntry<InventoryReport> = {
        logEntryId: randomId(),
        user: auth,
        dataType: "inventory",
        identifier: report.inventoryReportId,
        data: {
          before: report,
        },
        timestamp: admin.firestore.Timestamp.now(),
        operation: "create"
      }
      
      await admin.firestore().collection("logs").doc(logEntry.logEntryId).set(logEntry);
      await admin.firestore().collection("inventories").doc(report.inventoryReportId).update({
        auth: admin.firestore.FieldValue.delete()
      });

    }
  } catch (error) {
    functions.logger.error("inventory:error:" + error);
  }
});
exports.logIssued = functions.firestore.document("issued/{issuedReportId}").onWrite(async (change) => {
  try {
    const { before, after } = change;

    if (before.exists && after.exists) {
      // update event
      const beforeData = before.data() as IssuedReport;
      const afterData = after.data() as IssuedReport;

      delete beforeData.auth;
      const { auth, ...report } = afterData;
      if (!afterData?.auth) {
        functions.logger.error("issued:update: No AuthData defined");
        return;
      }

      const logEntry: LogEntry<IssuedReport> = {
        logEntryId: randomId(),
        user: afterData.auth,
        dataType: "issued",
        identifier: beforeData.issuedReportId,
        data: {
          before: beforeData,
          after: report,
        },
        timestamp: admin.firestore.Timestamp.now(),
        operation: "update"
      }
  
      await admin.firestore().collection("logs").doc(logEntry.logEntryId).set(logEntry);
      await admin.firestore().collection("issued").doc(report.issuedReportId).update({
        auth: admin.firestore.FieldValue.delete()
      });

    } else if (!after.exists) {
      // delete event
      const beforeData = before.data() as IssuedReport;
      const { auth, ...report } = beforeData;
      if (!auth) {
        functions.logger.error("issued:remove: No AuthData defined");
        return;
      }

      delete beforeData.auth;
      const logEntry: LogEntry<IssuedReport> = {
        logEntryId: randomId(),
        user: auth,
        dataType: "issued",
        identifier: report.issuedReportId,
        data: {
          before: report,
        },
        timestamp: admin.firestore.Timestamp.now(),
        operation: "remove"
      }

      await admin.firestore().collection("logs").doc(logEntry.logEntryId).set(logEntry);
      await admin.firestore().collection("issued").doc(report.issuedReportId).update({
        auth: admin.firestore.FieldValue.delete()
      });

    } else {
      // create event
      const afterData = after.data() as IssuedReport;
      const { auth, ...report } = afterData;
      if (!auth) {
        functions.logger.error("issued:create: No AuthData defined");
        return;
      }

      const logEntry: LogEntry<IssuedReport> = {
        logEntryId: randomId(),
        user: auth,
        dataType: "issued",
        identifier: report.issuedReportId,
        data: {
          before: report,
        },
        timestamp: admin.firestore.Timestamp.now(),
        operation: "create"
      }
      
      await admin.firestore().collection("logs").doc(logEntry.logEntryId).set(logEntry);
      await admin.firestore().collection("issued").doc(report.issuedReportId).update({
        auth: admin.firestore.FieldValue.delete()
      });

    }
  } catch (error) {
    functions.logger.error("issued:error:" + error);
  }
});
exports.logStockCard = functions.firestore.document("cards/{stockCardId}").onWrite(async (change) => {
  try {
    const { before, after } = change;

    if (before.exists && after.exists) {
      // update event
      const beforeData = before.data() as StockCard;
      const afterData = after.data() as StockCard;

      delete beforeData.auth;
      const { auth, ...report } = afterData;
      if (!afterData?.auth) {
        functions.logger.error("stockCard:update: No AuthData defined");
        return;
      }

      const logEntry: LogEntry<StockCard> = {
        logEntryId: randomId(),
        user: afterData.auth,
        dataType: "stockCard",
        identifier: afterData.stockCardId,
        data: {
          before: beforeData,
          after: report,
        },
        timestamp: admin.firestore.Timestamp.now(),
        operation: "update"
      }
  
      await admin.firestore().collection("logs").doc(logEntry.logEntryId).set(logEntry);
      await admin.firestore().collection("cards").doc(report.stockCardId).update({
        auth: admin.firestore.FieldValue.delete()
      });

    } else if (!after.exists) {
      // delete event
      const beforeData = before.data() as StockCard;
      const { auth, ...report } = beforeData;
      if (!auth) {
        functions.logger.error("stockCards:remove: No AuthData defined");
        return;
      }

      delete beforeData.auth;
      const logEntry: LogEntry<StockCard> = {
        logEntryId: randomId(),
        user: auth,
        dataType: "stockCard",
        identifier: beforeData.stockCardId,
        data: {
          before: report,
        },
        timestamp: admin.firestore.Timestamp.now(),
        operation: "remove"
      }

      await admin.firestore().collection("logs").doc(logEntry.logEntryId).set(logEntry);
      await admin.firestore().collection("cards").doc(report.stockCardId).update({
        auth: admin.firestore.FieldValue.delete()
      });

    } else {
      // create event
      const afterData = after.data() as StockCard;
      const { auth, ...report } = afterData;
      if (!auth) {
        functions.logger.error("stockCards:create: No AuthData defined");
        return;
      }

      const logEntry: LogEntry<StockCard> = {
        logEntryId: randomId(),
        user: auth,
        dataType: "stockCard",
        identifier: afterData.stockCardId,
        data: {
          before: report,
        },
        timestamp: admin.firestore.Timestamp.now(),
        operation: "create"
      }
      
      await admin.firestore().collection("logs").doc(logEntry.logEntryId).set(logEntry);
      await admin.firestore().collection("cards").doc(report.stockCardId).update({
        auth: admin.firestore.FieldValue.delete()
      });

    }
  } catch (error) {
    functions.logger.error("stockCards:error:" + error);
  }
});
exports.logUser = functions.firestore.document("users/{userId}").onWrite(async (change) => {
  try {
    const { before, after } = change;

    if (before.exists && after.exists) {
      // update event
      const beforeData = before.data() as FirestoreUser;
      const afterData = after.data() as FirestoreUser;

      delete beforeData.auth;
      const { auth, ...user } = afterData;
      if (!afterData?.auth) {
        functions.logger.error("user:update: No AuthData defined");
        return;
      }

      const logEntry: LogEntry<FirestoreUser> = {
        logEntryId: randomId(),
        user: afterData.auth,
        dataType: "user",
        identifier: beforeData.userId,
        data: {
          before: beforeData,
          after: user,
        },
        timestamp: admin.firestore.Timestamp.now(),
        operation: "update"
      }
  
      await admin.firestore().collection("logs").doc(logEntry.logEntryId).set(logEntry);
      await admin.firestore().collection("users").doc(user.userId).update({
        auth: admin.firestore.FieldValue.delete()
      });

    } else if (!after.exists) {
      // delete event
      const beforeData = before.data() as FirestoreUser;
      const { auth, ...user } = beforeData;
      if (!auth) {
        functions.logger.error("user:remove: No AuthData defined");
        return;
      }

      delete beforeData.auth;
      const logEntry: LogEntry<FirestoreUser> = {
        logEntryId: randomId(),
        user: auth,
        dataType: "user",
        identifier: user.userId,
        data: {
          before: user,
        },
        timestamp: admin.firestore.Timestamp.now(),
        operation: "remove"
      }

      await admin.firestore().collection("logs").doc(logEntry.logEntryId).set(logEntry);
      await admin.firestore().collection("users").doc(user.userId).update({
        auth: admin.firestore.FieldValue.delete()
      });

    } else {
      // create event
      const afterData = after.data() as FirestoreUser;
      const { auth, ...user } = afterData;
      if (!auth) {
        functions.logger.error("user:create: No AuthData defined");
        return;
      }

      const logEntry: LogEntry<FirestoreUser> = {
        logEntryId: randomId(),
        user: auth,
        dataType: "user",
        identifier: user.userId,
        data: {
          before: user,
        },
        timestamp: admin.firestore.Timestamp.now(),
        operation: "create"
      }
      
      await admin.firestore().collection("logs").doc(logEntry.logEntryId).set(logEntry);
      await admin.firestore().collection("users").doc(user.userId).update({
        auth: admin.firestore.FieldValue.delete()
      });

    }
  } catch (error) {
    functions.logger.error("user:error:" + error);
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
 * @returns string the generated id
 */
 function randomId() {
  const characters = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let id = "";
  for (let i = 0; i < 20; i++) {
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
