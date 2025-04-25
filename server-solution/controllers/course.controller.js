import { Course } from "../models/course.model.js";
import { Lecture } from "../models/lecture.model.js";
import { User } from "../models/user.model.js";
import { deleteMediaFromCloudinary, uploadMedia } from "../utils/cloudinary.js";
import { catchAsync } from "../middleware/error.middleware.js";
import { AppError } from "../middleware/error.middleware.js";
import fs from "fs/promises";

/**
 * Create a new course
 * @route POST /api/v1/courses
 */
export const createNewCourse = catchAsync(async (req, res) => {
  const { title, subtitle, description, category, level, price } = req.body;

  // Handle thumbnail upload
  let thumbnail;
  if (req.file) {
    const result = await uploadMedia(req.file.path);
    thumbnail = result?.secure_url || req.file.path;
  } else {
    throw new AppError("Course thumbnail is required", 400);
  }

  // Create course
  const course = await Course.create({
    title,
    subtitle,
    description,
    category,
    level,
    price,
    thumbnail,
    instructor: req.id,
  });

  // Add course to instructor's created courses
  await User.findByIdAndUpdate(req.id, {
    $push: { createdCourses: course._id },
  });

  res.status(201).json({
    success: true,
    message: "Course created successfully",
    data: course,
  });
});

/**
 * Search courses with filters
 * @route GET /api/v1/courses/search
 */
export const searchCourses = catchAsync(async (req, res) => {
  const {
    query = "",
    categories = [],
    level,
    priceRange,
    sortBy = "newest",
  } = req.query;

  // Create search query
  const searchCriteria = {
    isPublished: true,
    $or: [
      { title: { $regex: query, $options: "i" } },
      { subtitle: { $regex: query, $options: "i" } },
      { description: { $regex: query, $options: "i" } },
    ],
  };

  // Apply filters
  if (categories.length > 0) {
    searchCriteria.category = { $in: categories };
  }
  if (level) {
    searchCriteria.level = level;
  }
  if (priceRange) {
    const [min, max] = priceRange.split("-");
    searchCriteria.price = { $gte: min || 0, $lte: max || Infinity };
  }

  // Define sorting
  const sortOptions = {};
  switch (sortBy) {
    case "price-low":
      sortOptions.price = 1;
      break;
    case "price-high":
      sortOptions.price = -1;
      break;
    case "oldest":
      sortOptions.createdAt = 1;
      break;
    default:
      sortOptions.createdAt = -1;
  }

  const courses = await Course.find(searchCriteria)
    .populate({
      path: "instructor",
      select: "name avatar",
    })
    .sort(sortOptions);

  res.status(200).json({
    success: true,
    count: courses.length,
    data: courses,
  });
});

/**
 * Get all published courses
 * @route GET /api/v1/courses/published
 */
export const getPublishedCourses = catchAsync(async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 10;
  const skip = (page - 1) * limit;

  const [courses, total] = await Promise.all([
    Course.find({ isPublished: true })
      .populate({
        path: "instructor",
        select: "name avatar",
      })
      .populate({
        path: "lectures",
        select: "duration",
      })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),
    Course.countDocuments({ isPublished: true }),
  ]);

  // Calculate total duration for each course
  const coursesWithDuration = courses.map(course => {
    const totalDuration = course.lectures.reduce((sum, lecture) => sum + (lecture.duration || 0), 0);
    return {
      ...course.toJSON(),
      totalDuration,
      totalLectures: course.lectures.length
    };
  });

  res.status(200).json({
    success: true,
    data: coursesWithDuration,
    pagination: {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit),
    },
  });
});

/**
 * Get courses created by the current user
 * @route GET /api/v1/courses/my-courses
 */
export const getMyCreatedCourses = catchAsync(async (req, res) => {
  const courses = await Course.find({ instructor: req.id }).populate({
    path: "enrolledStudents",
    select: "name avatar",
  });

  res.status(200).json({
    success: true,
    count: courses.length,
    data: courses,
  });
});

/**
 * Update course details
 * @route PATCH /api/v1/courses/:courseId
 */
export const updateCourseDetails = catchAsync(async (req, res) => {
  const { courseId } = req.params;
  const { title, subtitle, description, category, level, price, isPublished } = req.body;

  const course = await Course.findById(courseId);
  if (!course) {
    throw new AppError("Course not found", 404);
  }

  // Verify ownership
  if (course.instructor.toString() !== req.id) {
    throw new AppError("Not authorized to update this course", 403);
  }

  // Handle thumbnail upload
  let thumbnail;
  if (req.file) {
    if (course.thumbnail) {
      await deleteMediaFromCloudinary(course.thumbnail);
    }
    const result = await uploadMedia(req.file.path);
    thumbnail = result?.secure_url || req.file.path;
  }

  // Convert isPublished to boolean if it's a string
  const publishStatus = isPublished === 'true' || isPublished === true;

  const updatedCourse = await Course.findByIdAndUpdate(
    courseId,
    {
      title,
      subtitle,
      description,
      category,
      level,
      price,
      isPublished: publishStatus,
      ...(thumbnail && { thumbnail }),
    },
    { new: true, runValidators: true }
  );

  res.status(200).json({
    success: true,
    message: "Course updated successfully",
    data: updatedCourse,
  });
});

/**
 * Get course by ID
 * @route GET /api/v1/courses/:courseId
 */
export const getCourseDetails = catchAsync(async (req, res) => {
  const course = await Course.findById(req.params.courseId)
    .populate({
      path: "instructor",
      select: "name avatar bio",
    })
    .populate({
      path: "lectures",
      select: "title videoUrl duration isPreview order",
    });

  if (!course) {
    throw new AppError("Course not found", 404);
  }

  res.status(200).json({
    success: true,
    data: {
      ...course.toJSON(),
      averageRating: course.averageRating,
    },
  });
});

/**
 * Add lecture to course
 * @route POST /api/v1/courses/:courseId/lectures
 */
export const addLectureToCourse = catchAsync(async (req, res) => {
  const { title, description, isPreview } = req.body;
  const { courseId } = req.params;

  // Get course and verify ownership
  const course = await Course.findById(courseId);
  if (!course) {
    throw new AppError("Course not found", 404);
  }
  if (course.instructor.toString() !== req.id) {
    throw new AppError("Not authorized to update this course", 403);
  }

  // Handle video upload
  if (!req.file) {
    throw new AppError("Video file is required", 400);
  }

  // Validate file size (500MB limit)
  const maxSize = 500 * 1024 * 1024; // 500MB in bytes
  if (req.file.size > maxSize) {
    throw new AppError("Video file size must be less than 500MB", 400);
  }

  // Validate file type
  const allowedTypes = ['video/mp4', 'video/webm', 'video/ogg', 'video/quicktime'];
  if (!allowedTypes.includes(req.file.mimetype)) {
    throw new AppError("Only MP4, WebM, Ogg, and MOV video formats are allowed", 400);
  }

  try {
    // Upload video to cloudinary
    const result = await uploadMedia(req.file.path);
    if (!result || !result.secure_url) {
      throw new AppError("Failed to upload video", 500);
    }

    // Create lecture with video details from cloudinary
    const lecture = await Lecture.create({
      title,
      description,
      isPreview,
      order: course.lectures.length + 1,
      videoUrl: result.secure_url,
      publicId: result.public_id,
      duration: result.duration || 0,
    });

    // Add lecture to course
    course.lectures.push(lecture._id);
    await course.save();

    res.status(201).json({
      success: true,
      message: "Lecture added successfully",
      data: lecture,
    });
  } catch (error) {
    // Clean up the uploaded file if it exists
    if (req.file && req.file.path) {
      try {
        await fs.unlink(req.file.path);
      } catch (unlinkError) {
        console.error("Error cleaning up uploaded file:", unlinkError);
      }
    }
    throw error;
  }
});

/**
 * Get course lectures
 * @route GET /api/v1/courses/:courseId/lectures
 */
export const getCourseLectures = catchAsync(async (req, res) => {
  const course = await Course.findById(req.params.courseId).populate({
    path: "lectures",
    select: "title description videoUrl duration isPreview order",
    options: { sort: { order: 1 } },
  });

  if (!course) {
    throw new AppError("Course not found", 404);
  }

  // Check if user has access to full course content
  const isEnrolled = course.enrolledStudents.includes(req.id);
  const isInstructor = course.instructor.toString() === req.id;

  let lectures = course.lectures;
  if (!isEnrolled && !isInstructor) {
    // Only return preview lectures for non-enrolled users
    lectures = lectures.filter((lecture) => lecture.isPreview);
  }

  res.status(200).json({
    success: true,
    data: {
      lectures,
      isEnrolled,
      isInstructor,
    },
  });
});

/**
 * Toggle course publish status
 * @route PATCH /api/v1/courses/:courseId/publish
 */
export const toggleCoursePublish = catchAsync(async (req, res) => {
  const { courseId } = req.params;

  const course = await Course.findById(courseId);
  if (!course) {
    throw new AppError("Course not found", 404);
  }

  // Verify ownership
  if (course.instructor.toString() !== req.id) {
    throw new AppError("Not authorized to update this course", 403);
  }

  // Toggle publish status
  course.isPublished = !course.isPublished;
  await course.save();

  res.status(200).json({
    success: true,
    message: course.isPublished ? "Course published successfully" : "Course unpublished successfully",
    data: course,
  });
});

/**
 * Get courses enrolled by the current user
 * @route GET /api/v1/courses/enrolled
 */
export const getMyEnrolledCourses = catchAsync(async (req, res) => {
  const user = await User.findById(req.id).populate({
    path: "enrolledCourses",
    select: "title subtitle description category level price thumbnail instructor totalDuration",
    populate: {
      path: "instructor",
      select: "name avatar",
    },
  });

  if (!user) {
    throw new AppError("User not found", 404);
  }

  res.status(200).json({
    success: true,
    count: user.enrolledCourses.length,
    data: user.enrolledCourses,
  });
});
