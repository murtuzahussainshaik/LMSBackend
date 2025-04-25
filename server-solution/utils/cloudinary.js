import { v2 as cloudinary } from "cloudinary";
import dotenv from "dotenv";
import { createReadStream } from "fs";
dotenv.config({});

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const MAX_RETRIES = 3;
const RETRY_DELAY = 2000; // 2 seconds

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const uploadWithRetry = async (file, options, retryCount = 0) => {
  try {
    // Use upload_stream for more reliable uploads
    return new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        options,
        (error, result) => {
          if (error) {
            reject(error);
          } else {
            resolve(result);
          }
        }
      );

      // Create read stream and pipe to upload stream
      const readStream = createReadStream(file);
      readStream.pipe(uploadStream);
    });
  } catch (error) {
    if (retryCount < MAX_RETRIES) {
      console.log(`Upload attempt ${retryCount + 1} failed, retrying...`);
      await sleep(RETRY_DELAY * (retryCount + 1));
      return uploadWithRetry(file, options, retryCount + 1);
    }
    throw error;
  }
};

export const uploadMedia = async (file) => {
  try {
    // Determine resource type based on file extension
    const isVideo = file.toLowerCase().endsWith('.mp4') || 
                   file.toLowerCase().endsWith('.webm') || 
                   file.toLowerCase().endsWith('.ogg');

    const uploadOptions = {
      resource_type: isVideo ? "video" : "auto",
      chunk_size: 6000000, // 6MB chunks for video uploads
      timeout: 180000, // 3 minutes timeout
      eager: isVideo ? [
        { format: "mp4", quality: "auto" }
      ] : undefined,
      eager_async: true,
      // Add folder to organize uploads
      folder: isVideo ? "course-videos" : "course-images"
    };

    console.log("Starting upload with options:", uploadOptions);
    const uploadResponse = await uploadWithRetry(file, uploadOptions);
    console.log("Upload successful:", uploadResponse);
    return uploadResponse;
  } catch (error) {
    console.error("Cloudinary upload error:", error);
    throw new Error("Failed to upload media: " + (error.message || "Unknown error"));
  }
};

export const deleteMediaFromCloudinary = async (publicId) => {
  try {
    await cloudinary.uploader.destroy(publicId);
  } catch (error) {
    console.error("Cloudinary delete error:", error);
    throw new Error("Failed to delete media: " + (error.message || "Unknown error"));
  }
};

export const deleteVideoFromCloudinary = async (publicId) => {
  try {
    await cloudinary.uploader.destroy(publicId, { resource_type: "video" });
  } catch (error) {
    console.error("Cloudinary video delete error:", error);
    throw new Error("Failed to delete video: " + (error.message || "Unknown error"));
  }
};
